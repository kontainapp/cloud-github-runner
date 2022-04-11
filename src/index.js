const azure = require('./azure.js');
const aws = require('./aws');
const gh = require('./gh');
const config = require('./config');
const core = require('@actions/core');


function setOutput(run_labels) {

    core.info("run-ons: " + JSON.stringify(run_labels));

    core.setOutput('run-ons', JSON.stringify(run_labels));
}

const startEC2 = async () => {

    const ec2_label = config.getEC2RunOnLabel();
    const userData = await gh.buildUserDataScript(ec2_label);
    await aws.startRunner(userData);
    await gh.waitForRunnerRegistered(ec2_label);

    return ec2_label;
}

const startAzure = async () => {

    const azure_label = config.getAzureRunOnLabel();
    const userData = await gh.buildUserDataScript(azure_label);
    await azure.startRunner(userData);
    await gh.waitForRunnerRegistered(azure_label);

    return azure_label;
}


const start = async() => {

    core.info('Getting job information');
    gh.getJobInfo();

    const run_labels = {ec2: "none", azure: "none"};

    const promises = ["none", "none"];

    if (config.input.coulds === 'ec2' || config.input.coulds === 'both') {
        // starting ec2
        promises[0] = startEC2();
    }
    if (config.input.coulds === 'azure' || config.input.coulds === 'both') {
        // starting azure 
        promises[1] = startAzure();
    }

    [run_labels.ec2, run_labels.azure] = await Promise.all(promises);

    setOutput(run_labels);

}

const stopEC2 = async () => {
    const ec2_gh_label = config.getEC2RunOnLabel();
    
    core.info(`Removing runner ${ec2_gh_label}`);
    await gh.removeRunner(ec2_gh_label);
    await aws.stopRunner()
}

const stopAzure = async () => {
    const azure_gh_label = config.getAzureRunOnLabel();

    core.info(`Removing runner ${azure_gh_label}`);
    await gh.removeRunner(azure_gh_label);
    await azure.stopRunner();
}

const stop = async () => {

    await Promise.all([stopEC2(), stopAzure()]);
}

(async function () {
    try {
        config.input.mode === 'start' ? await start() : await stop();
    } catch (error) {
        core.error(error);
        core.setFailed(error.message);
    }
})();
