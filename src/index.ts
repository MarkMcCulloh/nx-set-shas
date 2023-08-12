import { Octokit } from '@octokit/action';
import { setOutput } from '@actions/core';
import { context } from '@actions/github';
import { execSync } from 'node:child_process';

const {
  runId,
  repo: { repo, owner },
  eventName,
} = context;

const baseBranchName = "main"
const branchName = process.env.BRANCH_NAME;

if(!branchName) {
  throw new Error("BRANCH_NAME is not defined")
}

(async () => {
  console.log(JSON.stringify(process.argv));
  const HEAD_SHA = execSync(`git rev-parse HEAD`, { encoding: 'utf-8' }).toString();

  let BASE_SHA = await findSuccessfulCommit(
    runId,
    owner,
    repo,
    baseBranchName,
    branchName,
    eventName
  );

  // If no successful workflow run is found, use the branching point from the base branch
  if (BASE_SHA) {
    console.log(`Found successful run for this workflow. Using it as BASE_SHA`);
  } else {
    BASE_SHA = execSync(`git merge-base origin/${baseBranchName} ${HEAD_SHA}`).toString();
    console.log(`
			\n
			No successful run for this workflow found on the branch ${branchName}.\n
			Using the branching point between origin/${baseBranchName} and this branch's head ${HEAD_SHA}\n
      BASE_SHA=${BASE_SHA}
			\n
		`);
  }

  const stripNewLineEndings = (sha) => sha.replace('\n', '');
  setOutput('base', stripNewLineEndings(BASE_SHA));
  setOutput('head', stripNewLineEndings(HEAD_SHA));
})();

async function findSuccessfulCommit(
  run_id: number,
  owner: string,
  repo: string,
  baseBranchName: string,
  branchName: string,
  lastSuccessfulEvent: string
) {
  const octokit = new Octokit();
  const workflowId = await octokit
    .request(`GET /repos/${owner}/${repo}/actions/runs/${run_id}`, {
      owner,
      repo,
      branch: baseBranchName,
      run_id,
    })
    .then(({ data: { workflow_id } }) => workflow_id);

  const shas = await octokit
    .request(
      `GET /repos/${owner}/${repo}/actions/workflows/${workflowId}/runs`,
      {
        owner,
        repo,
        branch: branchName,
        workflowId,
        event: lastSuccessfulEvent,
        status: 'success',
      }
    )
    .then(({ data: { workflow_runs } }) =>
      workflow_runs.map((run) => run.head_sha)
    );

  return await findExistingCommit(shas);
}

/**
 * Get first existing commit
 * @param {string[]} shas
 * @returns {Promise<string | undefined>}
 */
async function findExistingCommit(shas) {
  for (const commitSha of shas) {
    if (await commitExists(commitSha)) {
      return commitSha;
    }
  }
  return undefined;
}

/**
 * Check if given commit is valid
 * @param {string} commitSha
 * @returns {Promise<boolean>}
 */
async function commitExists(commitSha) {
  try {
    execSync(`git cat-file -e ${commitSha}`, { stdio: ['pipe', 'pipe', null] });
    return true;
  } catch {
    return false;
  }
}