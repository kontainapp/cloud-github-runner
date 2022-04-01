const azure = require('./azure.js');
const aws = require('./aws');
const gh = require('./gh');
const config = require('./config');
const core = require('@actions/core');


function setOutput(run_labels) {

    core.info("run-ons: " + JSON.stringify(run_labels));

    core.setOutput('run-ons', JSON.stringify(run_labels));
}

async function start() {

    const run_labels = {
    };

    if (config.input.coulds === 'ec2' || config.input.coulds === 'both') {
        // starting ec2
        run_labels.ec2 = config.getEC2RunOnLabel();
        const userData = await gh.buildUserDataScript(run_labels.ec2);
        await aws.startRunner(userData);
        await gh.waitForRunnerRegistered(run_labels.ec2);
    }

    if (config.input.coulds === 'azure' || config.input.coulds === 'both') {
        // starting azure 
        run_labels.azure = config.getAzureRunOnLabel();
        const userData = await gh.buildUserDataScript(run_labels.azure);
        await azure.startRunner(userData);
        await gh.waitForRunnerRegistered(run_labels.azure);
    }
    setOutput(run_labels);

}

async function stop() {

    const ec2_gh_label = config.getEC2RunOnLabel();
    const azure_gh_label = config.getAzureRunOnLabel();

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
