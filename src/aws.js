const AWS = require('aws-sdk');
const core = require('@actions/core');
const config = require('./config');

// User data scripts are run as the root user
function buildUserDataScript(githubRegistrationToken, githubDownloadURL, label) {
  if (config.input.runnerHomeDir) {
    // If runner home directory is specified, we expect the actions-runner software (and dependencies)
    // to be pre-installed in the AMI, so we simply cd into that directory and then start the runner
    return [
      '#!/bin/bash',
      `cd "${config.input.runnerHomeDir}"`,
      `echo ./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} | su ${config.input.runnerUser} `,
      'echo ./run.sh | su ${config.input.runnerUser} ',
    ];
  } else {
    return [
      '#!/bin/bash',
      `mkdir actions-runner && chown ${config.input.runnerUser} actions-runner && cd actions-runner`,
      `curl -o actions-runner-linux-x64.tar.gz -s -L ${githubDownloadURL}`,
      `echo tar xzf actions-runner-linux-x64.tar.gz | su ${config.input.runnerUser} `,
      `echo ./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --ephemeral | su ${config.input.runnerUser} `,
      `echo ./run.sh | su ${config.input.runnerUser} `,
    ];
  }
}

async function startEc2Instance(label, githubRegistrationToken, githubDownloadURL) {
  const ec2 = new AWS.EC2();

  const userData = buildUserDataScript(githubRegistrationToken, githubDownloadURL, label);

  const params = {
    ImageId: config.input.ec2ImageId,
    InstanceType: config.input.ec2InstanceType,
    MinCount: 1,
    MaxCount: 1,
    UserData: Buffer.from(userData.join('\n')).toString('base64'),
    SubnetId: config.input.subnetId,
    SecurityGroupIds: [config.input.securityGroupId],
    IamInstanceProfile: { Name: config.input.iamRoleName },
    TagSpecifications: config.tagSpecifications,
    VirtualName: config.input.virtualName,
  };

  try {
    const result = await ec2.runInstances(params).promise();
    const ec2InstanceId = result.Instances[0].InstanceId;
    core.info(`AWS EC2 instance ${ec2InstanceId} is started`);
    return ec2InstanceId;
  } catch (error) {
    core.error('AWS EC2 instance starting error');
    throw error;
  }
}

async function terminateEc2Instance(mode) {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: [config.input.ec2InstanceId],
  };

  try {
    // for backwards compatibility, 'stop' means end the execution and get rid of the VM.
    // 'suspend' means keep the VM in stopped state even thought in EC2 the terms are
    // 'stop' to keep the VM and 'terminate' to destroy it
    if (mode === 'stop') {
      await ec2.terminateInstances(params).promise();
      core.info(`AWS EC2 instance ${config.input.ec2InstanceId} is terminated`);
    } else {
      await ec2.stopInstances(params).promise();
      core.info(`AWS EC2 instance ${config.input.ec2InstanceId} is stopped`);
    }
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${config.input.ec2InstanceId} termination error`);
    throw error;
  }
}

async function waitForInstanceRunning(ec2InstanceId) {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: [ec2InstanceId],
  };

  try {
    await ec2.waitFor('instanceRunning', params).promise();
    core.info(`AWS EC2 instance ${ec2InstanceId} is up and running`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${ec2InstanceId} initialization error`);
    throw error;
  }
}

module.exports = {
  startEc2Instance,
  terminateEc2Instance,
  waitForInstanceRunning,
};
