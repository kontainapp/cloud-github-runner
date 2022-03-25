const AWS = require('aws-sdk');
const core = require('@actions/core');
const config = require('./config');


async function startEc2Instance(userData) {
  const ec2 = new AWS.EC2();

  const instanceParams = {
    ImageId: config.input.ec2ImageId,
    InstanceType: config.input.ec2InstanceType,
    MinCount: 1,
    MaxCount: 1,
    UserData: Buffer.from(userData.join('\n')).toString('base64'),
    SubnetId: config.input.ec2SubnetId,
    SecurityGroupIds: [config.input.ec2SecurityGroupId],
    IamInstanceProfile: { Name: config.input.ec2IamRoleName },
    TagSpecifications: config.ec2tagSpecifications,
  };


  try {
    const result = await ec2.runInstances(instanceParams).promise();
    const ec2InstanceId = result.Instances[0].InstanceId;
    core.info(`AWS EC2 instance ${ec2InstanceId} have started`);
    return ec2InstanceId;
  } catch (error) {
    core.error('AWS EC2 instance starting error');
    throw error;
  }
}

async function stopRunner() {
  const ec2 = new AWS.EC2();

  if (!config.input.ec2InstanceId) {
    core.info(`AWS EC2 instance doe s not exist. Nothinng to stop or terminate`);
    return;
  }

  const params = {
    InstanceIds: [config.input.ec2InstanceId],
  };

  // if there was no failure on previous related jobs. i.e isFailure is false
  // we terminate the VM; otherwise we just stop it so it is ready for future examination
  try {
    if (config.terminateInstance) {
      core.info(`Terminating ec2 instance ${config.input.ec2InstanceId}`);
      await ec2.terminateInstances(params).promise();
      core.info(`AWS EC2 instance ${config.input.ec2InstanceId} is terminated`);
    } else {
      core.info(`Stopping ec2 instance ${config.input.ec2InstanceId}`);
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
  stopRunner,
  waitForInstanceRunning,
};
