import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'yaml';

const source = await readFile(new URL('../../.github/workflows/catalog-sync.yml', import.meta.url), 'utf8');
test('workflow is valid YAML and only schedule/manual/catalog dispatch can trigger it', () => {
  const workflow = parse(source, {uniqueKeys: true});
  assert.deepEqual(Object.keys(workflow.on).sort(), ['repository_dispatch', 'schedule', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.schedule, [{cron: '0 3,15 * * *'}]);
  assert.deepEqual(workflow.on.repository_dispatch.types, ['catalog_changed']);
  assert.equal(workflow.on.workflow_dispatch.inputs.dry_run.default, true);
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.ok(workflow.jobs.sync.if.includes("github.event_name == 'workflow_dispatch'"));
  assert.ok(workflow.jobs.sync.steps.every(step => !step.name || typeof step.name === 'string'));
});
test('historical unquoted colon step name is rejected before execution', () => {
  const invalid = source.replace('name: "Unchanged: no build, commit or deploy"', 'name: Unchanged: no build, commit or deploy');
  assert.notEqual(invalid, source);
  assert.throws(() => parse(invalid), /mapping|nested|compact/i);
});
