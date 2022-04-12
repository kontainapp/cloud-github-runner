const core = require('@actions/core');
const github = require('@actions/github');
const _ = require('lodash');
const config = require('./config');

async function getJobInfo() {
    const octokit = github.getOctokit(config.input.githubToken);

    try {

        const params = {
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            run_id: github.context.runId
        }
        core.info(`Getting all jobs using parameters ${JSON.stringify(params)}`);
        const jobs = await octokit.paginate('GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs', params);
    
        core.info(`Retrieved jobs: \n ${JSON.stringify(jobs)}`);

        for (const idx in jobs) {
            if (jobs[idx].name == github.context.job) {
                core.info(`Found my Job: ${github.context.job}`);
                break;
            }
        }        
    } catch (error) {
        return null;
    }
}
// use the unique label to find the runner
// as we don't have the runner's id, it's not possible to get it in any other way
async function getRunner(label) {
    const octokit = github.getOctokit(config.input.githubToken);


    try {

        const runners = await octokit.paginate('GET /repos/{owner}/{repo}/actions/runners', config.githubContext);
        // core.info( 'Found runners: ' +JSON.stringify(runners));
        // core.info(`looking for runner with label ${label}`);

        const foundRunners = _.filter(runners, { labels: [{ name: label }] });
        // core.info('Filtered runners: ' + JSON.stringify(foundRunners));

        return foundRunners.length > 0 ? foundRunners[0] : null;
    } catch (error) {
        core.error('Could not get jobs information');
        throw error;
    }
}

// get GitHub Registration Token for registering a self-hosted runner
async function getRegistrationToken() {
    const octokit = github.getOctokit(config.input.githubToken);

    try {
        const response = await octokit.request('POST /repos/{owner}/{repo}/actions/runners/registration-token', config.githubContext);
        core.info('GitHub Registration Token is received');
        return response.data.token;
    } catch (error) {
        core.error('GitHub Registration Token receiving error');
        throw error;
    }
}

// get GitHub download URL for installing a self-hosted runner
async function getDownloadURL() {
    const octokit = github.getOctokit(config.input.githubToken);

    try {
        const response = await octokit.request('GET /repos/{owner}/{repo}/actions/runners/downloads', config.githubContext);
        core.info('GitHub Download URL is received');
        return response.data.filter(function (n) {
            return n.os === "linux" && n.architecture === "x64";
        })[0].download_url;
    } catch (error) {
        core.error('GitHub Download URL receiving error');
        throw error;
    }
}

// User data scripts are run as the root user
async function buildUserDataScript(label) {

    const githubRegistrationToken = await getRegistrationToken();
    const githubDownloadURL = await getDownloadURL();

    return [
        '#!/bin/bash',
        `mkdir actions-runner && chown ${config.input.runnerUser} actions-runner && cd actions-runner`,
        `curl -o actions-runner-linux-x64.tar.gz -s -L ${githubDownloadURL}`,
        `echo tar xzf actions-runner-linux-x64.tar.gz | su ${config.input.runnerUser} `,
        `echo ./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} | su ${config.input.runnerUser} `,
        `echo ./run.sh | su ${config.input.runnerUser} `,
    ];
}


async function removeRunner(label) {

    const runner = await getRunner(label);
    const octokit = github.getOctokit(config.input.githubToken);

    // skip the runner removal process if the runner is not found
    if (!runner) {
        core.info(`GitHub self-hosted runner with label ${label} is not found, so the removal is skipped`);
        return;
    }

    core.info(`Found runner to be removed: ${runner.name}`);
    try {
        await octokit.request('DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}', _.merge(config.githubContext, { runner_id: runner.id }));
        core.info(`GitHub self-hosted runner ${runner.name} is removed`);
        return;
    } catch (error) {
        core.error('GitHub self-hosted runner removal error');
        throw error;
    }
}

async function waitForRunnerRegistered(label) {
    const timeoutMinutes = 5;
    const retryIntervalSeconds = 10;
    const quietPeriodSeconds = 30;
    let waitSeconds = 0;

    core.info(`Waiting ${quietPeriodSeconds}s for the ${label} runner to be registered in GitHub as a new self-hosted runner`);
    await new Promise(r => setTimeout(r, quietPeriodSeconds * 1000));
    core.info(`Checking every ${retryIntervalSeconds}s if the GitHub self-hosted runner is registered`);

    return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
            const runner = await getRunner(label);

            if (waitSeconds > timeoutMinutes * 60) {
                core.error('GitHub self-hosted runner registration error');
                clearInterval(interval);
                reject(`A timeout of ${timeoutMinutes} minutes is exceeded. Your AWS EC2 instance was not able to register itself in GitHub as a new self-hosted runner.`);
            }

            if (runner && runner.status === 'online') {
                core.info(`GitHub self-hosted runner ${runner.name} is registered and ready to use`);
                clearInterval(interval);
                resolve();
            } else {
                waitSeconds += retryIntervalSeconds;
                core.info('Checking...');
            }
        }, retryIntervalSeconds * 1000);
    });
}

module.exports = {
    buildUserDataScript,
    removeRunner,
    waitForRunnerRegistered,
    getJobInfo
};
