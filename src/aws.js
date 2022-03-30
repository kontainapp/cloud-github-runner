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

async function startEc2Instance(userData) {

    authenticate();

    const ec2 = new AWS.EC2();
    let params = {};
    let result = null;

    // retrive image ami id by name
    params = {
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

    result = await ec2.describeImages(params).promise();
    const imageId = result.ImageId;

    // check if VPC exist by name 
    params = {
        Filters: [
            {
                Name: "tag:Name",
                Values: [
                    config.input.vpcName
                ]
            },
        ],
    };
    let vpcInfo = null;
    result = await ec2.describeVpcs(params).promise();
    if (result.Vpcs.length == 0) {

        //create VPC
        params = {
            CidrBlock: config.input.subnet + "/16",
            TagSpecifications: [
                {
                    ResourceType: "vpc",
                    Tags: [{
                        Key: "Name",
                        Value: config.label
                    }]
                }
            ]
        };
        vpcInfo = await ec2.createVpc(params).promise();
        // wait for it to be created
        params = {
            VpcIds: [vpcInfo.VpcId]
        };
        await ec2.waitFor('vpcExists', params).promise();
    }
    else {
        vpcInfo = result.Vpcs[0];
    }

    // retrieve subnet id from target vpc 
    params = {
        Filters: [
            {
                Name: "vpc-id",
                Values: [
                    config.input.ec2VPCId
                ]
            }
        ]
    };
    result = await ec2.describeSubnets(params).promise();
    const subnetId = result.Subnets[0].SubnetId;

    // get security group id from target VPC - same filtering parameters as above 
    result = await ec2.describeSecurityGroups(params).promise();
    const secirityGroupId = result.SecurityGroups[0].GroupId;

    // start instance using all the collecte information
    params = {
        ImageId: imageId,
        InstanceType: config.input.ec2InstanceType,
        MinCount: 1,
        MaxCount: 1,
        UserData: Buffer.from(userData.join('\n')).toString('base64'),
        SubnetId: subnetId,
        SecurityGroupIds: [secirityGroupId],
        IamInstanceProfile: { Name: config.input.ec2IamRoleName },
        TagSpecifications: config.ec2tagSpecifications,
    };
    const instanceInfo = await ec2.runInstances(params).promise();
    const ec2InstanceId = instanceInfo.Instances[0].InstanceId;
    // wait untill it starts
    params = {
        InstanceIds: [ec2InstanceId],
    };
    await ec2.waitFor('instanceRunning', params).promise();
}

const startRunner = async (userData) => {
    try {
        const ec2InstanceId = startEc2Instance(userData);
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

    // if (!config.input.ec2InstanceId) {
    //   core.info(`AWS EC2 instance doe s not exist. Nothinng to stop or terminate`);
    //   return;
    // }

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
    let instanceId;

    core.info(`Looking for EC2 Instance ${ec2_tag}`);
    result = await ec2.describeInstances(params).promise();
    if (result.Reservations.length == 0) {
        // no instance exists - nothing to do 
        core.info(`EC2 instance ${ec2_tag} has never started`);
        return;
    }
    else {
        const instance = result.Reservations[0].Instances[0];

        instanceId = instance.InstanceId;
        core.info(`Found EC2 instace with id ${instanceId}`);
    }

    // if there was no failure on previous related jobs. i.e isFailure is false
    // we terminate the VM; otherwise we just stop it so it is ready for future examination
    params = {
        InstanceIds: [instanceId],
    };

    try {
        if (config.terminateInstance) {
            core.info(`Terminating ec2 instance ${instanceId}`);
            await ec2.terminateInstances(params).promise();
            core.info(`AWS EC2 instance ${instanceId} is terminated`);
        } else {
            core.info(`Stopping ec2 instance ${instanceId}`);
            await ec2.stopInstances(params).promise();
            core.info(`AWS EC2 instance ${instanceId} is stopped`);
        }
        return;
    } catch (error) {
        core.error(`AWS EC2 instance ${instanceId} termination error`);
        throw error;
    }
}

// async function waitForInstanceRunning(ec2InstanceId) {

//   const ec2 = new AWS.EC2();

//   const params = {
//     InstanceIds: [ec2InstanceId],
//   };

//   try {
//     await ec2.waitFor('instanceRunning', params).promise();
//     core.info(`AWS EC2 instance ${ec2InstanceId} is up and running`);
//     return;
//   } catch (error) {
//     core.error(`AWS EC2 instance ${ec2InstanceId} initialization error`);
//     throw error;
//   }
// }

module.exports = {
    startRunner,
    stopRunner,
    // waitForInstanceRunning,
};
