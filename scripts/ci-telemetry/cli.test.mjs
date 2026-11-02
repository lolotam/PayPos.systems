import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('./cli.mjs', import.meta.url));

const USAGE_ERROR = 'ci-telemetry: usage error (E_USAGE)\n';
const INTERNAL_ERROR = '::error title=ci-telemetry::telemetry report failed (E_INTERNAL)\n';

const summary = (status) => ({
  turboVersion: '2.11.2',
  execution: {
    success: 1,
    failed: 0,
    cached: 0,
    attempted: 1,
    startTime: 1793646205131,
    endTime: 1793646209367,
    exitCode: 0,
  },
  tasks: [
    {
      taskId: '@pospay/ids#build',
      task: 'build',
      package: '@pospay/ids',
      cache: { local: false, remote: false, status, timeSaved: 0 },
      execution: { startTime: 1793646205552, endTime: 1793646209365, exitCode: 0 },
      dependencies: [],
    },
  ],
});

// The child never inherits a step summary, unless the test points it at one.
const runCli = (args, extraEnv = {}) => {
  const env = { ...process.env, ...extraEnv };
  if (!('GITHUB_STEP_SUMMARY' in extraEnv)) delete env.GITHUB_STEP_SUMMARY;
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8', env });
};

const workspace = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ci-telemetry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};

test('two valid summaries produce a report with two runs', (t) => {
  const root = workspace(t);
  const runs = join(root, 'runs');
  mkdirSync(runs);
  writeFileSync(join(runs, 'a.json'), JSON.stringify(summary('MISS')));
  writeFileSync(join(runs, 'b.json'), JSON.stringify(summary('HIT')));
  const out = join(root, 'out');
  const result = runCli(['--label', 'check', '--turbo-runs', runs, '--out', out]);

  assert.equal(result.status, 0);
  const report = JSON.parse(readFileSync(join(out, 'check.json'), 'utf8'));
  assert.equal(report.label, 'check');
  assert.equal(report.runs.length, 2);
  const markdown = readFileSync(join(out, 'check.md'), 'utf8');
  assert.equal(markdown.includes('turbo run 1'), true);
  assert.equal(markdown.includes('turbo run 2'), true);
});

test('invalid task timing is incomplete in JSON and Markdown, while zero duration is valid', (t) => {
  const root = workspace(t);
  const runs = join(root, 'runs');
  const out = join(root, 'out');
  mkdirSync(runs);
  for (const status of ['MISS', 'HIT']) {
    for (const timing of ['missing-start', 'missing-end', 'reversed', 'zero']) {
      const raw = summary(status);
      const execution = raw.tasks[0].execution;
      if (status === 'HIT') delete execution.exitCode;
      if (timing === 'missing-start') delete execution.startTime;
      if (timing === 'missing-end') delete execution.endTime;
      if (timing === 'reversed') execution.endTime = execution.startTime - 1;
      if (timing === 'zero') execution.endTime = execution.startTime;
      writeFileSync(join(runs, 'a.json'), JSON.stringify(raw));
      const result = runCli(['--label', 'check', '--turbo-runs', runs, '--out', out]);
      assert.equal(result.status, 0);
      const report = JSON.parse(readFileSync(join(out, 'check.json'), 'utf8'));
      const markdown = readFileSync(join(out, 'check.md'), 'utf8');
      const valid = timing === 'zero';
      assert.equal(report.runs[0].complete, valid, `${status}: ${timing}`);
      assert.equal(report.runs[0].reason, valid ? null : 'unfinished');
      assert.equal(report.runs[0].tasks[0].durationMs, valid ? 0 : null);
      assert.equal(markdown.includes('INCOMPLETE turbo run 1 (unfinished)'), !valid);
    }
  }
});

test('an empty array file is one incomplete run with a shape reason', (t) => {
  const root = workspace(t);
  const runs = join(root, 'runs');
  mkdirSync(runs);
  writeFileSync(join(runs, 'a.json'), '[]');
  const out = join(root, 'out');
  const result = runCli(['--label', 'check', '--turbo-runs', runs, '--out', out]);

  assert.equal(result.status, 0);
  const report = JSON.parse(readFileSync(join(out, 'check.json'), 'utf8'));
  assert.equal(report.runs.length, 1);
  assert.equal(report.runs[0].complete, false);
  assert.equal(report.runs[0].reason, 'shape');
  assert.deepEqual(report.incomplete, []);
  const markdown = readFileSync(join(out, 'check.md'), 'utf8');
  assert.equal(markdown.includes('INCOMPLETE turbo run 1 (shape)'), true);
});

test('an array containing a valid summary is not unpacked', (t) => {
  const root = workspace(t);
  const runs = join(root, 'runs');
  mkdirSync(runs);
  writeFileSync(join(runs, 'a.json'), JSON.stringify([summary('MISS')]));
  const out = join(root, 'out');
  const result = runCli(['--label', 'check', '--turbo-runs', runs, '--out', out]);

  assert.equal(result.status, 0);
  const report = JSON.parse(readFileSync(join(out, 'check.json'), 'utf8'));
  assert.equal(report.runs.length, 1);
  assert.equal(report.runs[0].complete, false);
  assert.equal(report.runs[0].reason, 'shape');
  assert.deepEqual(report.incomplete, []);
});

test('a report without a complete run never looks clean', (t) => {
  const root = workspace(t);
  const emptyArray = join(root, 'empty-array');
  mkdirSync(emptyArray);
  writeFileSync(join(emptyArray, 'a.json'), '[]');
  const missing = join(root, 'missing');
  const empty = join(root, 'empty');
  mkdirSync(empty);
  const unreadable = join(root, 'unreadable');
  mkdirSync(unreadable);
  writeFileSync(join(unreadable, 'a.json'), '{not json');
  const directories = [emptyArray, missing, empty, unreadable];
  const out = join(root, 'out');

  for (const [index, runs] of directories.entries()) {
    const label = `case-${index}`;
    const result = runCli(['--label', label, '--turbo-runs', runs, '--out', out]);

    assert.equal(result.status, 0);
    const report = JSON.parse(readFileSync(join(out, `${label}.json`), 'utf8'));
    assert.equal(report.runs.length === 0 && report.incomplete.length === 0, false);
    assert.equal(
      report.runs.some((run) => run.complete === true),
      false,
    );
    const hasIncompleteEvidence =
      report.runs.some((run) => run.complete === false) || report.incomplete.length > 0;
    assert.equal(hasIncompleteEvidence, true);
  }
});

test('a missing folder is reported, never counted as zero tasks', (t) => {
  const root = workspace(t);
  const out = join(root, 'out');
  const result = runCli(['--label', 'check', '--turbo-runs', join(root, 'nope'), '--out', out]);

  assert.equal(result.status, 0);
  const report = JSON.parse(readFileSync(join(out, 'check.json'), 'utf8'));
  assert.deepEqual(report.runs, []);
  assert.equal(report.incomplete.includes('turbo-runs: missing'), true);
});

test('an empty folder is reported, never counted as a success', (t) => {
  const root = workspace(t);
  const runs = join(root, 'runs');
  mkdirSync(runs);
  const out = join(root, 'out');
  const result = runCli(['--label', 'check', '--turbo-runs', runs, '--out', out]);

  assert.equal(result.status, 0);
  const report = JSON.parse(readFileSync(join(out, 'check.json'), 'utf8'));
  assert.deepEqual(report.runs, []);
  assert.equal(report.incomplete.includes('turbo-runs: none found'), true);
});

test('an unreadable file is reported by its position, never by its name', (t) => {
  const root = workspace(t);
  const runs = join(root, 'runs');
  mkdirSync(runs);
  writeFileSync(join(runs, 'a.json'), JSON.stringify(summary('MISS')));
  writeFileSync(join(runs, 'b.json'), '{not json');
  writeFileSync(join(runs, 'c.json'), JSON.stringify(summary('HIT')));
  const out = join(root, 'out');
  const result = runCli(['--label', 'check', '--turbo-runs', runs, '--out', out]);

  assert.equal(result.status, 0);
  const report = JSON.parse(readFileSync(join(out, 'check.json'), 'utf8'));
  assert.equal(report.incomplete.includes('turbo-run 2: invalid-json'), true);
  assert.equal(report.runs.length, 2);
  assert.equal(result.stdout.includes('b.json'), false);
  assert.equal(result.stderr.includes('b.json'), false);
});

test('a missing option or a label with an upper-case letter is a usage error', (t) => {
  const root = workspace(t);
  const runs = join(root, 'runs');
  mkdirSync(runs);
  const out = join(root, 'out');

  const missing = runCli(['--turbo-runs', runs, '--out', out]);
  assert.equal(missing.status, 2);
  assert.equal(missing.stderr, USAGE_ERROR);

  const upper = runCli(['--label', 'Check', '--turbo-runs', runs, '--out', out]);
  assert.equal(upper.status, 2);
  assert.equal(upper.stderr, USAGE_ERROR);
});

test('an output path that is a file fails without leaking the path', (t) => {
  const root = workspace(t);
  const runs = join(root, 'runs');
  mkdirSync(runs);
  writeFileSync(join(runs, 'a.json'), JSON.stringify(summary('MISS')));
  const outFile = join(root, 'out.json');
  writeFileSync(outFile, 'x');
  const result = runCli(['--label', 'check', '--turbo-runs', runs, '--out', outFile]);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, INTERNAL_ERROR);
  assert.equal(result.stderr.includes(root), false);
});

test('the markdown is appended to the step summary', (t) => {
  const root = workspace(t);
  const runs = join(root, 'runs');
  mkdirSync(runs);
  writeFileSync(join(runs, 'a.json'), JSON.stringify(summary('MISS')));
  const out = join(root, 'out');
  const stepSummary = join(root, 'step-summary.md');
  writeFileSync(stepSummary, '# existing\n');
  const result = runCli(['--label', 'check', '--turbo-runs', runs, '--out', out], {
    GITHUB_STEP_SUMMARY: stepSummary,
  });

  assert.equal(result.status, 0);
  const content = readFileSync(stepSummary, 'utf8');
  assert.equal(content.startsWith('# existing\n'), true);
  assert.equal(content.includes('CI telemetry'), true);
});
