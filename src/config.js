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
      mode: core.getInput('mode'),
      githubToken: core.getInput('github-token'),
      runnerUser: core.getInput('runner-user'),
      runnerHomeDir: core.getInput('runner-home-dir'),
      // ec2 variables
      ec2ImageId: core.getInput('ec2-image-id'),
      ec2InstanceType: core.getInput('ec2-instance-type'),
      ec2SubnetId: core.getInput('ec2-subnet-id'),
      ec2SecurityGroupId: core.getInput('ec2-security-group-id'),
      ec2InstanceId: core.getInput('ec2-instance-id'),
      ec2IamRoleName: core.getInput('ec2-iam-role-name'),
      // azure variables
      azSubscriptionId: core.getInput('az-subscription-id'),//${{ secrets.SP_SUBSCRIPTION_ID }}
      azClientId: core.getInput('az-client-id'),//${{ secrets.SP_APPID }}
      azSecret: core.getInput('az-secret'),//${{ secrets.SP_PASSWORD }}
      azTenantId: core.getInput('az-tenant-id'),//${{ secrets.SP_TENANT }}
      azImage: core.getInput('az-image'),  //"groupName:imageName L0BaseImage",
      azLocation: core.getInput('az-location'),//"westus",
      azSubnet: core.getInput('az-subnet'),
      azVmSize: core.getInput('az-vm-size'),
      azPubKeys: core.getInput('az-public-keys'),

    };

    // the values of github.context.repo.owner and github.context.repo.repo are taken from
    // the environment variable GITHUB_REPOSITORY specified in "owner/repo" format and
    // provided by the GitHub Action on the runtime
    this.githubContext = {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
    };

    this.label = 'runner-' + github.context.workflow.replace(/\s/g, '-') + '-' + github.context.runNumber;

    const tags = [{ "Key": "Name", "Value": `ec2-${this.label}` }];
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
      if (!this.input.ec2ImageId || !this.input.ec2InstanceType || !this.input.ec2SubnetId || !this.input.ec2SecurityGroupId) {
        throw new Error(`Not all the required inputs are provided for the 'start' mode for ec2`);
      }
      if (!this.input.azImage || !this.input.azLocation || !this.input.azPubKeys || !this.input.azSubnet || !this.input.azVmSize) {
        throw new Error(`Not all the required inputs are provided for the 'start' mode for azure`);
      }
    } else if (this.input.mode === 'stop') {
      core.info(`Processing stop mode for ec2InstanceId: ${this.input.ec2InstanceId}`);

      this.terminateInstance = true;
      const status = core.getInput('status');

      if (!status) {
        throw new Error(`Missing required input parameter: status`);
      }
      if (!this.input.ec2InstanceId) {
        // instance id registered - definitely there was an error
        this.terminateInstance == false;
      }
      core.info(`Checking status of ancestorial jobs`);
      // check status of needed jobs
      if (status) {
        const needs_data = JSON.parse(status);
        core.info("passed in needs data: " + JSON.stringify(needs_data));

        Object.keys(needs_data).forEach(function (key) {
          if (needs_data[key].result == 'failure') {
            this.terminateInstance == false;
          }
        });
      }
    } else {
      throw new Error('Wrong mode. Allowed values: start, stop');
    }
    core.info(`do terminate? ${this.terminateInstance}`);
  }
}

try {
  module.exports = new Config();
} catch (error) {
  core.error(error);
  core.setFailed(error.message);
}
