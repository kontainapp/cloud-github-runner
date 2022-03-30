const azure = require('./azure.js');
const aws = require('./aws');
const gh = require('./gh');
const config = require('./config');
const core = require('@actions/core');


function setOutput(label, ec2InstanceId) {
  //core.setOutput('label', label);
  //core.setOutput('ec2-instance-id', ec2InstanceId);

  const run_labels = {
    ec2: config.getEC2RunOnLabel(),
    azure: config.getAzureRunOnLabel()
  };

  core.info("run-ons: " + JSON.stringify(run_labels));

  core.setOutput('run-ons', JSON.stringify(run_labels));
}

async function start() {

  const ec2_gh_label = config.getEC2RunOnLabel();
  const azure_gh_label = config.getAzureRunOnLabel();
  
  // starting ec2
  let userData = await gh.buildUserDataScript(ec2_gh_label);
  core.info("userData for ec2: = " + userData.toString());
  const ec2InstanceId = await aws.startRunner(userData);

  // set output as soon as we can so we will be able to clean up correctly
  setOutput(config.label, ec2InstanceId);

  // now wait and register
  //await aws.waitForInstanceRunning(ec2InstanceId);
  await gh.waitForRunnerRegistered(ec2_gh_label);

  // starting azure 
  userData = await gh.buildUserDataScript(azure_gh_label);
  core.info("userData for azure: = " + userData.toString());
  await azure.startRunner(userData);
  await gh.waitForRunnerRegistered(azure_gh_label);

}

async function stop() {

  const ec2_gh_label = config.getEC2RunOnLabel();
  const azure_gh_label = config.getAzureRunOnLabel();

  if (!config.label) {
    // nothing was created 
    return;
  }

  core.info(`Removing runner ${ec2_gh_label}`);
  await gh.removeRunner(ec2_gh_label);
  await aws.stopRunner();

  core.info(`Removing runner ${azure_gh_label}`);
  await gh.removeRunner(azure_gh_label);
  await azure.stopRunner();
}

(async function () {
  try {
    config.input.mode === 'start' ? await start() : await stop();
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();
