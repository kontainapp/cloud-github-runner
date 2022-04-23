const fs = require("fs");
const path = require('path');
const AWS = require('aws-sdk');
const core = require('@actions/core');
const config = require('./config');

const REGION_REGEX = /^[a-z0-9-]+$/g;

const authenticate = async () => {

    if (!config.input.ec2Region.match(REGION_REGEX)) {
        throw new Error(`Region is not valid: ${config.input.ec2Region}`);
    }

    core.exportVariable('AWS_ACCESS_KEY_ID', config.input.ec2AccessKeyId);
    core.exportVariable('AWS_SECRET_ACCESS_KEY', config.input.ec2SecretAccessKey);

    core.exportVariable('AWS_DEFAULT_REGION', config.input.ec2Region);
    core.exportVariable('AWS_REGION', config.input.ec2Region);
}

const getImageId = async (ec2) => {

    // retrive image ami id by name
    const params = {
        Filters: [
            {
                Name: 'name',
                Values: [config.input.ec2Image]
            }
        ],
        Owners: [
            "self"
        ]
    };

    core.info(`Getting information for ${config.input.ec2Image} image `);
    const result = await ec2.describeImages(params).promise();
    if (result.Images.length == 0) {
        throw Error(`Image ${config.input.ec2Image} is not found`);
    }
    const imageId = result.Images[0].ImageId;
    core.info(`Found AMI with id ${imageId}`);

    return imageId;
}

const getOrCreateSubnet = async (ec2, vpcId) => {

    let subnetId = null;
    let result = null;

    // get subnet info
    let params = {
        Filters: [
            {
                Name: 'vpc-id',
                Values: [
                    vpcId,
                ]
            },
        ],
    };

    core.info(`Getting Subnet Info`);
    result = await ec2.describeSubnets(params).promise();
    if (result.Subnets.length == 0) {
        // create subnet
        core.info(`Subnet not found. Creating subnet`)
        params = {
            CidrBlock: "10.0.1.0/24",
            VpcId: vpcId,
            TagSpecifications: [
                {
                    ResourceType: "subnet",
                    Tags: [{
                        Key: "Name",
                        Value: config.input.ec2VPCName + '-subnet'
                    }]
                }
            ]
        };
        result = await ec2.createSubnet(params).promise();
        subnetId = result.Subnet.SubnetId;

        core.info(`Subnet ${subnetId} created. Waiting for it to become available`);
        params = {
            SubnetIds: [subnetId]
        };
        await ec2.waitFor('subnetAvailable', params).promise();
        core.info(`Subnet is available`);

        // allow public IPV4s for instances
        core.info(`Alowing public IPV4 address for subnet ${subnetId}`);
        params = {
            SubnetId: subnetId,
            MapPublicIpOnLaunch: { Value: true }
        };

        result = await ec2.modifySubnetAttribute(params).promise();
        core.info(``);

        // create gateway
        core.info(`Creating gateway`);
        params = {
            TagSpecifications: [
                {
                    ResourceType: "internet-gateway",
                    Tags: [
                        {
                            Key: 'Name',
                            Value: config.input.ec2VPCName + '-gtw'
                        }
                    ]
                }
            ]
        };
        result = await ec2.createInternetGateway(params).promise();
        const gatewayId = result.InternetGateway.InternetGatewayId;
        core.info(`Gateway ${gatewayId} created`);

        // attach gateway
        core.info(`Attaching gateway to VPC`);
        params = {
            InternetGatewayId: gatewayId,
            VpcId: vpcId
        };
        await ec2.attachInternetGateway(params).promise();
        core.info(`Done`);

        // create Route Table 
        core.info(`Ctreating Route table`);
        params = {
            VpcId: vpcId
        };
        result = await ec2.createRouteTable(params).promise();
        const routeTableId = result.RouteTable.RouteTableId;
        core.info(`Route table ${routeTableId} created`);

        // create route
        core.info(`Creating route`);
        params = {
            DestinationCidrBlock: "0.0.0.0/0",
            GatewayId: gatewayId,
            RouteTableId: routeTableId
        };
        result = await ec2.createRoute(params).promise();
        core.info(`Done`);

        core.info(`Associating route table to subnet`);
        // associate route table to subnet
        params = {
            RouteTableId: routeTableId,
            SubnetId: subnetId
        };
        await ec2.associateRouteTable(params).promise();
        core.info(`Done`);
    }
    else {
        subnetId = result.Subnets[0].SubnetId;
        core.info(`Subnet ${subnetId} found`);
    }

    return subnetId;
}

const addSSHKeys = (userData) => {

    if (!config.input.publicKeysDir) {
        return;
    }
    if (!fs.existsSync(config.input.publicKeysDir)) {
        core.setFailed(`directory ${config.input.publicKeysDir} does not exist`);
        return;
    }
    const files = fs.readdirSync(config.input.publicKeysDir).filter((elm) => /.*\.pub/gi.test(elm))
    for (var i = 0; i < files.length; i++) {
        const data = fs.readFileSync(path.join(config.input.publicKeysDir, files[i])).toString();
        userData.splice(userData.length - 1, 0, `echo -n "${data}" >> /home/${config.input.runnerUser}/.ssh/authorized_keys`);
    }
}

const startEc2Instance = async (userData) => {

    core.info('Authenticating AWS');
    authenticate();

    const ec2 = new AWS.EC2();

    let params = {};
    let result = null;

    const imageId = await getImageId(ec2);

    core.info(`Checking if VPC ${config.input.ec2VPCName} exists`);
    params = {
        Filters: [
            {
                Name: "tag:Name",
                Values: [
                    config.input.ec2VPCName
                ]
            },
        ],
    };
    let vpcId = null;
    let subnetId = null;
    let securityGroupId = null;

    let new_vpc = false;

    core.info(`Checking if VPC ${config.input.ec2VPCName} exists`);
    result = await ec2.describeVpcs(params).promise();
    if (result.Vpcs.length == 0) {
        core.info(`VPC ${config.input.ec2VPCName} does not yet exists - creating`);
        new_vpc = true;
        //create VPC
        params = {
            CidrBlock: config.input.subnet + "/16",
            TagSpecifications: [
                {
                    ResourceType: "vpc",
                    Tags: [{
                        Key: "Name",
                        Value: config.input.ec2VPCName
                    }]
                }
            ]
        };
        result = await ec2.createVpc(params).promise();
        vpcId = result.Vpc.VpcId;
        core.info(`VPC ${config.input.ec2VPCName} created with id ${result.VpcId}.`);
        // wait for it to be created
        params = {
            VpcIds: [vpcId]
        };
        await ec2.waitFor('vpcAvailable', params).promise();

    }
    else {
        core.info(`VPC ${config.input.ec2VPCName} exists`);

        vpcId = result.Vpcs[0].VpcId;
    }

    subnetId = await getOrCreateSubnet(ec2, vpcId);

    core.info(`Getting default Security group`);
    // get security group
    params = {
        Filters: [
            {
                Name: 'vpc-id',
                Values: [
                    vpcId,
                ]
            },
        ],
    };
    result = await ec2.describeSecurityGroups(params).promise();
    securityGroupId = result.SecurityGroups[0].GroupId;
    core.info(`Security Group  ${securityGroupId} found`);

    if (new_vpc) {
        core.info(`Setting up SSH access`);
        params = {
            GroupId: securityGroupId,
            IpPermissions: [
                {
                    FromPort: 22,
                    IpProtocol: "tcp",
                    IpRanges: [
                        {
                            CidrIp: "0.0.0.0/0",
                            Description: "SSH access"
                        }
                    ],
                    ToPort: 22
                }
            ]
        };
        result = await ec2.authorizeSecurityGroupIngress(params).promise();

    }

    //augment user data with providede ssh keys
    addSSHKeys(userData);

    // start instance using all the collecte information
    core.info(`Starting an Instance`);
    params = {
        ImageId: imageId,
        InstanceType: config.input.ec2InstanceType,
        MinCount: 1,
        MaxCount: 1,
        UserData: Buffer.from(userData.join('\n')).toString('base64'),
        SubnetId: subnetId,
        SecurityGroupIds: [securityGroupId],
        IamInstanceProfile: { Name: config.input.ec2IamRoleName },
        TagSpecifications: config.ec2tagSpecifications,
    };
    const instanceInfo = await ec2.runInstances(params).promise();
    const ec2InstanceId = instanceInfo.Instances[0].InstanceId;
    core.info(`Instance created with id ${ec2InstanceId}. Waiting for it to reach running state`);
    // wait untill it starts
    params = {
        InstanceIds: [ec2InstanceId],
    };
    await ec2.waitFor('instanceRunning', params).promise();
    // wait for instance to finish initializing
    await ec2.waitFor('instanceStatusOk', params).promise();

    return ec2InstanceId;
}

const startRunner = async (userData) => {
    try {
        const ec2InstanceId = await startEc2Instance(userData);
        core.info(`AWS EC2 instance ${ec2InstanceId} have started`);
        return ec2InstanceId;
    } catch (error) {
        core.error('AWS EC2 instance starting error');
        throw error;
    }
}

async function stopRunner() {

    authenticate();

    const ec2 = new AWS.EC2();
    let params = {};
    let result = null;

    const ec2_tag = config.getEC2RunOnLabel();

    const instanceIds = [];

    // find instance by name 
    params = {
        Filters: [
            {
                Name: "tag:Name",
                Values: [
                    ec2_tag
                ]
            }
        ]
    };

    core.info(`Looking for EC2 Instance ${ec2_tag}`);
    result = await ec2.describeInstances(params).promise();

    core.info(`Reservations: `);
    core.info(`${JSON.stringify(result.Reservations)}`);
    if (result.Reservations.length == 0) {
        // no instance exists - nothing to do 
        core.info(`EC2 instance ${ec2_tag} has never started`);
        return;
    }
    else {
        const instance_count = result.Reservations.length;
        core.info(`Found ${instance_count} instances`)
        for (let i = 0; i < instance_count; i++) {
            const instance = result.Reservations[i].Instances[0];
            core.info(`Instanse ${i} - ${JSON.stringify(instance)}`)
            core.info(`Instance ${instance.InstanceId} - Status ${instance.State.Name}`);
            if (instance.State.Name == 'pending' || instance.State.Name == 'running') {
                core.info(`Adding instanceId ${instance.InstanceId} to teh array`);
                instanceIds.push(instance.InstanceId);
            }
            else {
                core.info(`skipping non-running instance`);
            }
        }

        core.info(`Found EC2 instaces with id ${JSON.stringify(instanceIds)}`);
    }

    // if there was no failure on previous related jobs. i.e isFailure is false
    // we terminate the VM; otherwise we just stop it so it is ready for future examination
    params = {
        InstanceIds: instanceIds,
    };

    try {
        if (config.terminateInstance) {
            core.info(`Terminating ec2 instances ${JSON.stringify(instanceIds)}`);
            await ec2.terminateInstances(params).promise();
            core.info(`AWS EC2 instances ${JSON.stringify(instanceIds)} is terminated`);
        } else {
            core.info(`Stopping ec2 instances ${JSON.stringify(instanceIds)}`);
            await ec2.stopInstances(params).promise();
            core.info(`AWS EC2 instances ${JSON.stringify(instanceIds)} is stopped`);
        }
        return;
    } catch (error) {
        core.error(`AWS EC2 instances ${JSON.stringify(instanceIds)} termination error`);
        throw error;
    }
}

module.exports = {
    startRunner,
    stopRunner,
};
