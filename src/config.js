const core = require('@actions/core');
const github = require('@actions/github');
class Config {
    getAzureRunOnLabel() {
        return "azure-" + this.label;
    }

    getEC2RunOnLabel() {
        return "ec2-" + this.label;
    }

    constructor() {
        this.input = {
            // common variables
            coulds: core.getInput('clouds'),
            mode: core.getInput('mode'),
            githubToken: core.getInput('github-token'),
            runnerUser: core.getInput('runner-user'),
            subnet: core.getInput('subnet'),
            publicKeysDir: core.getInput('public-keys-dir'),
            // ec2 variables
            ec2AccessKeyId: core.getInput('ec2-access-key-id'),
            ec2SecretAccessKey: core.getInput('ec2-secret-access-key'),
            ec2Region: core.getInput('ec2-region'),
            ec2Image: core.getInput('ec2-image'),  //"L0BaseAWSImage",
            ec2InstanceType: core.getInput('ec2-instance-type'),
            ec2VPCName: core.getInput('ec2-vpc-name'),
            ec2IamRoleName: core.getInput('ec2-iam-role-name'),
            ec2Tags: core.getInput('ec2-tags'),
            // azure variables
            azSubscriptionId: core.getInput('az-subscription-id'),//${{ secrets.SP_SUBSCRIPTION_ID }}
            azClientId: core.getInput('az-client-id'),//${{ secrets.SP_APPID }}
            azSecret: core.getInput('az-secret'),//${{ secrets.SP_PASSWORD }}
            azTenantId: core.getInput('az-tenant-id'),//${{ secrets.SP_TENANT }}
            azImage: core.getInput('az-image'),  //"groupName:imageName L0BaseImage",
            azLocation: core.getInput('az-location'),//"westus",
            azVmSize: core.getInput('az-vm-size'),

        };
        const iodToken = core.getIDToken();
        core.debug(`oidToken = ${JSON.stringify}`);
        
        this.terminateInstance = true;

        // the values of github.context.repo.owner and github.context.repo.repo are taken from
        // the environment variable GITHUB_REPOSITORY specified in "owner/repo" format and
        // provided by the GitHub Action on the runtime
        this.githubContext = {
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
        };

        this.label = 'runner-' + github.context.workflow.replace(/\s/g, '-') + '-' + github.context.runNumber;

        let tags = [{ "Key": "Name", "Value": this.getEC2RunOnLabel() }];
        if (this.input.ec2Tags) {
            tags = tags.concat(JSON.parse(this.input.ec2Tags));
        }
        this.ec2tagSpecifications = [
            {
                ResourceType: 'instance',
                Tags: tags
            },
            {
                ResourceType: 'volume',
                Tags: tags
            }
        ];

        //
        // validate input
        //

        if (!this.input.mode) {
            throw new Error(`The 'mode' input is not specified`);
        }

        if (!this.input.githubToken) {
            throw new Error(`The 'github-token' input is not specified`);
        }

        if (this.input.mode === 'start') {
            if (!this.input.ec2Image || !this.input.ec2InstanceType || !this.input.ec2VPCName) {
                throw new Error(`Not all the required inputs are provided for the 'start' mode for ec2`);
            }
            if (!this.input.azImage || !this.input.azLocation || !this.input.publicKeysDir || !this.input.azVmSize) {
                throw new Error(`Not all the required inputs are provided for the 'start' mode for azure`);
            }
        } else if (this.input.mode === 'stop') {

            const status = core.getInput('status');

            if (!status) {
                throw new Error(`Missing required input parameter: status`);
            }
            core.info(`Checking status of ancestorial jobs`);
            // check status of needed jobs
            if (status) {
                const needs_data = JSON.parse(status);
                core.info("passed in needs data: " + JSON.stringify(needs_data));

                for (const key in needs_data) {
                    if (needs_data[key].result == 'failure') {
                        core.info('Found failed ancestor - stop but do not terminate');
                        this.terminateInstance = false;
                    }
                }
            }
        } else {
            throw new Error('Wrong mode. Allowed values: start, stop');
        }
    }
}

try {
    module.exports = new Config();
} catch (error) {
    core.error(error);
    core.setFailed(error.message);
}
