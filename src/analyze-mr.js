// Vendor
import request from 'request';
import simpleGit from 'simple-git';
import path from 'path';
// APP
import parse from './parse';
import updatePR from './apis/github/update-pr';
import updateMR from './apis/gitlab/update-mr';

// Package.JSON
let packageJSON = require(`${process.cwd()}/package.json`);
const GALAXY_SETTINGS = packageJSON.galaxy;

/**
 * Get the project's data
 */
async function getProjectData(name, FIREBASE_URL) {
    return new Promise((resolve, reject) => {
        request(`https://${FIREBASE_URL}/projects/${name}.json`, (err, res, body) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(JSON.parse(body));
        });
    });
}

/**
 * Gets the git diff for the branch
 */
async function getGitDiff(base, current) {
    return new Promise((resolve, reject) => {
        simpleGit().diffSummary([base, current], (err, data) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(data ? data : {});
        });
    });
}

function getDiffLabel(current, last) {
    if (last === 0) {
        return `+${current}%`;
    } else if (last > current) {
        return `-${Number(last - current).toFixed(2)}%`;
    } else if (current > last) {
        return `+${Number(current - last).toFixed(2)}%`;
    } else {
        return 'No Change';
    }
}

async function analyze(BRANCH, FIREBASE_URL, SLACK_HOOK, SLACK_CHANNEL, API_KEY) {
    // Make sure that we have galaxy configured in the package.json
    if (!GALAXY_SETTINGS) {
        console.error('[Galaxy Parser]: "galaxy" section not present in package.json. Please follow instructions inside README.md');
        return true;
    }

    // Make sure that we have a firebase url passed in
    if (!FIREBASE_URL) {
        console.error('[Galaxy Parser]: firebase url was not supplied. Please follow instructions inside README.md');
        return true;
    }

    if (!BRANCH) {
        console.error('[Galaxy Parser]: branch was not supplied. Please follow instructions inside README.md');
        return true;
    }

    if (!GALAXY_SETTINGS.defaultBranch) {
        console.error('[Galaxy Parser]: defaultBranch was not supplied. Please follow instructions inside README.md');
        return true;
    }

    try {
        // Get the data from the last run
        let lastRun = await getProjectData(packageJSON.name, FIREBASE_URL);
        // Parse the new results
        let currentRun = await parse(GALAXY_SETTINGS.locations);
        // Get the git diff for this branch
        let gitDiff = await getGitDiff(GALAXY_SETTINGS.defaultBranch, BRANCH);

        // Get a list of files that changes
        let changedFiles = [];
        if (gitDiff.files) {
            changedFiles = gitDiff.files.map(diff => path.basename(diff.file));
        }

        let overallCompare = {
            coverage: getDiffLabel(currentRun.totals.coverage.lines.percent, lastRun.coverage.current),
            files: []
        };

        // Compare the current file coverage to the last run
        // Map the files from lastRun and currentRun into objects to make things easier
        let lastRunData = {};
        let currentRunData = {};
        if (lastRun.files) {
            lastRun.files.forEach(file => {
                lastRunData[file.file] = {
                    lines: file.lines,
                    branches: file.branches,
                    functions: file.functions
                }
            });
        }
        currentRun.files.coverage.forEach(file => {
            currentRunData[file.file] = {
                lines: file.lines,
                branches: file.branches,
                functions: file.functions
            }
        });
        changedFiles.forEach(file => {
            if (lastRunData[file] || currentRunData[file]) {
                let last = lastRunData[file] ? Number(lastRunData[file].lines) : 0;
                let current = currentRunData[file] ? Number(currentRunData[file].lines) : 0;
                overallCompare.files.push({
                    name: file,
                    diff: getDiffLabel(current, last)
                });
            }
        });

        if (GALAXY_SETTINGS.api === 'github') {
            updatePR(overallCompare, BRANCH, GALAXY_SETTINGS.owner, GALAXY_SETTINGS.repo, API_KEY);
        } else if (GALAXY_SETTINGS.api === 'gitlab') {
            updateMR(overallCompare, BRANCH, GALAXY_SETTINGS.gitlabApiUrl, GALAXY_SETTINGS.gitlabProjectId, API_KEY);
        } else {
            console.log('[Galaxy Parser]: Invalid API -- cannot update MR/PR', GALAXY_SETTINGS.api);
        }
    } catch (e) {
        console.log('[Galaxy Parser]: ERROR', e);
    }
    return true;
}

export default analyze;