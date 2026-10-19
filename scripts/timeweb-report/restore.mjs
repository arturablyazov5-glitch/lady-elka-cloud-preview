import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
const repo = process.env.GITHUB_REPOSITORY;
if (repo !== 'arturablyazov5-glitch/lady-elka-cloud-preview') throw Error('Unexpected report repository');
const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const pages = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/actions/artifacts?name=timeweb-weekly-state&per_page=100`]));
const artifacts = pages.flatMap(page => page.artifacts).filter(a => a.name === 'timeweb-weekly-state' && !a.expired
  && a.workflow_run?.head_branch === 'main' && String(a.workflow_run.id) !== process.env.GITHUB_RUN_ID)
  .sort((a, b) => b.id - a.id);
if (!artifacts.length) { console.log('No previous report state'); process.exit(0); }
const run = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${artifacts[0].workflow_run.id}`]));
if (run.path !== '.github/workflows/timeweb-weekly.yml' || run.head_branch !== 'main' || run.repository.full_name !== repo)
  throw Error('Unexpected state provenance');
const directory = dirname(resolve(process.env.REPORT_STATE_PATH || '.timeweb-report/state.enc'));
await mkdir(directory, { recursive: true });
gh(['run', 'download', String(run.id), '--repo', repo, '--name', 'timeweb-weekly-state', '--dir', directory]);
console.log('Encrypted previous state restored');
