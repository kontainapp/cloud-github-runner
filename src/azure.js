const fs = require("fs");
const path = require('path');
const core = require('@actions/core');

const config = require('./config');

const { ClientSecretCredential } = require("@azure/identity");
const { ComputeManagementClient } = require('@azure/arm-compute');
const { ResourceManagementClient } = require("@azure/arm-resources");
const { NetworkManagementClient } = require("@azure/arm-network");

const createResourceGroup = async (resourceClient) => {
    const groupParameters = {
        location: config.input.azLocation,
    };
    return await resourceClient.resourceGroups.createOrUpdate(
        config.label,
        groupParameters
    );
}

const createVnet = async (networkClient) => {
    const vnetName = config.label + '-vnet';
    const subnetName = config.label + '-subnet';

    const vnetParameters = {
        location: config.input.azLocation,
        addressSpace: {
            addressPrefixes: [config.input.subnet + '/16']
        },
        subnets: [{
            name: subnetName, addressPrefix: config.input.subnet + '/24'
        }],
    };
    return await networkClient.virtualNetworks.beginCreateOrUpdateAndWait(config.label, vnetName, vnetParameters);
}

const createPublicIp = async (networkClient) => {
    const publicIPName = config.label + '-pip';
    const domainNameLabel = config.label.toLowerCase() + '-domain';

    const publicIPParameters = {
        location: config.input.azLocation,
        publicIPAllocationMethod: 'Dynamic',
        dnsSettings: {
            domainNameLabel: domainNameLabel
        }
    };
    return await networkClient.publicIPAddresses.beginCreateOrUpdateAndWait(config.label, publicIPName, publicIPParameters);
}

const getPublicIp = async (networkClient) => {
    return await networkClient.publicIPAddresses.get(config.label, config.label + '-pip');
}
const createNIC = async (networkClient, subnetInfo, publicIPInfo) => {
    const ipConfigName = config.label + '-config';
    const NICName = config.label + '-nic';

    const parameters = {
        location: config.input.azLocation,
        ipConfigurations: [
            {
                name: ipConfigName,
                privateIPAllocationMethod: 'Dynamic',
                subnet: subnetInfo,
                publicIPAddress: publicIPInfo
            }
        ]
    };
    return await networkClient.networkInterfaces.beginCreateOrUpdateAndWait(
        config.label,
        NICName,
        parameters
    );

}

const getNIC = async (networkClient) => {
    return await networkClient.networkInterfaces.get(config.label, config.label + '-nic');
}

const getSSHKeys = () => {

    const ssh_keys = [];
    if (!fs.existsSync(config.input.publicKeysDir)) {
        core.setFailed(`directory ${config.input.publicKeysDir} does not exist`);
        return;
    }
    const files = fs.readdirSync(config.input.publicKeysDir).filter((elm) => /.*\.pub/gi.test(elm))
    for (var i = 0; i < files.length; i++) {
        const data = fs.readFileSync(path.join(config.input.publicKeysDir, files[i])).toString();
        const key = {
            keyData: data,
            path: `/home/${config.input.runnerUser}/.ssh/authorized_keys`
        }
        ssh_keys.push(key)
    }
    return ssh_keys;
}

const createVM = async (computeClient, vmImageInfo, nicInfo, userData) => {

    const vmParameters = {
        location: config.input.azLocation,
        osProfile: {
            computerName: config.label + '-vm',
            adminUsername: config.input.runnerUser,
            linuxConfiguration: {
                disablePasswordAuthentication: true,
                ssh: {
                    publicKeys: getSSHKeys()
                }
            },
        },
        hardwareProfile: {
            vmSize: config.input.azVmSize
        },
        storageProfile: {
            imageReference: {
                id: vmImageInfo.id
            },
            osDisk: {
                name: config.label + '-osDisk',
                caching: 'none',
                createOption: 'fromImage',
                deleteOption: 'Delete',
                managedDisk: {
                    storageAccountType: "Standard_LRS",
                },
            },
        },
        networkProfile: {
            networkInterfaces: [
                {
                    id: nicInfo.id,
                    primary: true
                }
            ]
        },
        userData: Buffer.from(userData.join('\n')).toString('base64'),
    };
    return await computeClient.virtualMachines.beginCreateOrUpdateAndWait(config.label, config.label + '-vm', vmParameters);

}

const getVM = async (computeClient) => {
    return await computeClient.virtualMachines.get(config.label, config.label + '-vm');
}

const checkVmExists = async (computeClient) => {
    try {
        await getVM(computeClient);
        return true;
    } catch (error) {
        if (error.statusCode == 404) {
            return false;
        }
        throw error;
    }
}

const startRunner = async (userData) => {

    // authenticate 
    const credential = new ClientSecretCredential(
        config.input.azTenantId,
        config.input.azClientId,
        config.input.azSecret
    );
    const computeClient = new ComputeManagementClient(credential, config.input.azSubscriptionId);
    const networkClient = new NetworkManagementClient(credential, config.input.azSubscriptionId);
    const resourceClient = new ResourceManagementClient(credential, config.input.azSubscriptionId);

    try {
        await createResourceGroup(resourceClient);
        core.info("Resource group Created");

        await createVnet(networkClient);
        core.info("Vnet Created");

        const subnetInfo = await networkClient.subnets.get(config.label, config.label + '-vnet', config.label + '-subnet');
        core.info("subnet info retrieved");

        await createPublicIp(networkClient);
        const publicIPInfo = await getPublicIp(networkClient);
        core.info("Public IP created");

        await createNIC(networkClient, subnetInfo, publicIPInfo);
        const nicInfo = await getNIC(networkClient);
        core.info("NIC created");

        const image_data = config.input.azImage.split(":");
        const vmImageInfo = await computeClient.images.get(image_data[0], image_data[1]);

        await createVM(computeClient, vmImageInfo, nicInfo, userData);
        const vmInfo = await getVM(computeClient);

        core.debug(`AZURE VM INFO: ${JSON.stringify(vmInfo)}`);
        
        core.info("Azure VM has started");
    } catch (error) {
        core.error('Azure VM starting error');
        throw error;
    }
}

const stopRunner = async () => {
    const vmName = config.label + "-vm";

    // authenticate
    const credential = new ClientSecretCredential(
        config.input.azTenantId,
        config.input.azClientId,
        config.input.azSecret
    );

    const computeClient = new ComputeManagementClient(credential, config.input.azSubscriptionId);
    const resourceClient = new ResourceManagementClient(credential, config.input.azSubscriptionId);

    try {

        const exists = await resourceClient.resourceGroups.checkExistence(config.label);
        if (!exists.body) {
            core.info(`Azure Resource group ${config.label} does not exists`);
            core.info(`Nothing to stop or terminate`);
            return 'success';
        }
        if (config.terminateInstance) {
            await resourceClient.resourceGroups.beginDeleteAndWait(config.label);
            core.info(`Azure VM ${config.label} is terminated`)
        }
        else {
            const vmExists = await checkVmExists(computeClient);
            if (vmExists) {
                await computeClient.virtualMachines.beginPowerOff(config.label, vmName);
                await computeClient.virtualMachines.beginDeallocateAndWait(config.label, vmName);
                core.info(`Azure VM ${config.label}-vm is stopped`)
            }
            else {
                core.info("Azure VM not found. Nothing to stop");
            }
        }
    } catch (error) {
        core.error(`Azure VM ${config.label} stopping/termination error`);
        throw error;
    }
    return 'success';
}

module.exports = {
    startRunner,
    stopRunner
};
