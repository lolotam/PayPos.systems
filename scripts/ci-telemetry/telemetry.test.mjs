import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildReport, renderMarkdown, replayedTestTasks, summariseTurboRun } from './telemetry.mjs';

const FORBIDDEN = [
  'someone@example.com',
  '+00000000000',
  'FAKE_TOKEN_0000',
  '/home/runner/work/x',
  'C:\\Users\\x',
];

// The keys a Turbo summary carries and an artifact must not carry.
const BANNED_KEYS =
  'command environmentVariables inputs hash logFile directory user scm globalCacheInputs';

// The real shape of `.turbo/runs/<id>.json` on turbo 2.11.2, in its two real states: a forced run
// and a run Turbo answered from its cache.
const realRun = (status) => {
  const cached = status === 'HIT';
  return {
    turboVersion: '2.11.2',
    execution: {
      success: cached ? 0 : 1,
      failed: 0,
      cached: cached ? 1 : 0,
      attempted: 1,
      startTime: cached ? 1793646212392 : 1793646205131,
      endTime: cached ? 1793646212840 : 1793646209367,
      exitCode: 0,
    },
    tasks: [
      {
        taskId: '@pospay/ids#build',
        task: 'build',
        package: '@pospay/ids',
        cache: cached
          ? { local: true, remote: false, status, source: 'LOCAL', timeSaved: 3809 }
          : { local: false, remote: false, status, timeSaved: 0 },
        execution: {
          startTime: cached ? 1793646212838 : 1793646205552,
          endTime: cached ? 1793646212840 : 1793646209365,
          exitCode: 0,
        },
        dependencies: ['@pospay/config#build'],
      },
    ],
  };
};

const forcedRun = () => realRun('MISS');
const cachedRun = () => realRun('HIT');

const reportOf = (summary, extra = {}) =>
  buildReport({
    label: 'check',
    meta: {},
    runs: [summariseTurboRun(summary)],
    incomplete: [],
    ...extra,
  });

test('the report keeps the allowlisted fields and drops everything else', () => {
  const summary = forcedRun();
  summary.execution.command = 'pnpm turbo run build';
  summary.tasks[0].command = 'tsc -p tsconfig.json';
  summary.tasks[0].environmentVariables = { CI_TELEMETRY_PNPM_VERSION: '10.15.0' };
  summary.tasks[0].inputs = { 'src/index.ts': 'sha' };
  summary.tasks[0].hash = 'deadbeef';
  summary.tasks[0].logFile = '/home/runner/work/x/.turbo/runs/run.log';
  summary.tasks[0].directory = '/home/runner/work/x/packages/ids';
  summary.user = 'someone@example.com';
  summary.scm = { branch: 'main' };
  summary.globalCacheInputs = { rootKey: 'FAKE_TOKEN_0000' };

  const report = reportOf(summary);
  const json = JSON.stringify(report);
  const banned = BANNED_KEYS.split(' ');

  for (const key of banned) assert.equal(json.includes(`"${key}"`), false, key);
  assert.equal(json.includes('tsc -p tsconfig.json'), false);
  assert.equal(json.includes('pnpm turbo run build'), false);
  assert.equal(json.includes('/home/runner/work/x'), false);
  assert.equal(report.runs[0].durationMs, 4236);
  assert.equal(report.runs[0].tasks[0].durationMs, 3813);
  assert.equal(report.runs[0].tasks[0].cacheStatus, 'MISS');
  assert.equal(report.runs[0].tasks[0].cacheSource, null);
});

test('a cache status outside HIT and MISS is UNKNOWN', () => {
  const summary = forcedRun();
  summary.tasks[0].cache.status = 'PARTIAL';
  const run = summariseTurboRun(summary);
  assert.equal(run.tasks[0].cacheStatus, 'UNKNOWN');
  assert.equal(run.tasks[0].timeSavedMs, null);
});

test('an allowlisted name holding a forbidden value is rejected', () => {
  for (const forbidden of FORBIDDEN) {
    const summary = forcedRun();
    summary.turboVersion = forbidden;
    summary.tasks[0].package = forbidden;
    summary.tasks[0].task = forbidden;
    summary.tasks[0].taskId = forbidden;
    summary.tasks[0].dependencies = [forbidden];
    const report = reportOf(summary, { label: forbidden, incomplete: [forbidden] });
    const json = JSON.stringify(report);

    assert.equal(json.includes(forbidden), false, forbidden);
    assert.equal(renderMarkdown(report).includes(forbidden), false, forbidden);
    assert.equal(report.runs[0].turboVersion, null);
    assert.equal(report.runs[0].tasks[0].package, null);
    assert.equal(report.runs[0].tasks[0].task, null);
    assert.equal(report.runs[0].tasks[0].taskId, null);
    assert.deepEqual(report.runs[0].tasks[0].dependencies, []);
    assert.equal(report.label, null);
    assert.deepEqual(report.incomplete, []);
  }
});

test('both real runs are complete, the all-cached one included', () => {
  const forced = summariseTurboRun(forcedRun());
  assert.equal(forced.complete, true);
  assert.equal(forced.reason, null);
  assert.equal(forced.succeeded, 1);
  assert.equal(forced.cached, 0);

  const cached = summariseTurboRun(cachedRun());
  assert.equal(cached.complete, true);
  assert.equal(cached.reason, null);
  assert.equal(cached.succeeded, 0);
  assert.equal(cached.cached, 1);
});

test('a replayed task needs no exit code, an executed one does', () => {
  const replayed = cachedRun();
  delete replayed.tasks[0].execution.exitCode;
  const replay = summariseTurboRun(replayed);
  assert.equal(replay.complete, true);
  assert.equal(replay.tasks[0].exitCode, null);
  replayed.tasks[0].execution.exitCode = null;
  assert.equal(summariseTurboRun(replayed).complete, true);
  replayed.tasks[0].execution.exitCode = 1;
  assert.equal(summariseTurboRun(replayed).reason, 'count-mismatch');

  const executed = forcedRun();
  delete executed.tasks[0].execution.exitCode;
  const run = summariseTurboRun(executed);
  assert.equal(run.complete, false);
  assert.equal(run.reason, 'task-without-exit');
});

test('attempted that differs from the task count is a count mismatch', () => {
  const summary = forcedRun();
  summary.execution.attempted = 2;
  const run = summariseTurboRun(summary);
  assert.equal(run.complete, false);
  assert.equal(run.reason, 'count-mismatch');
});

test('an empty task list is empty, never a success', () => {
  const summary = forcedRun();
  summary.tasks = [];
  summary.execution.attempted = 0;
  const run = summariseTurboRun(summary);
  assert.equal(run.complete, false);
  assert.equal(run.reason, 'empty');
  assert.equal(renderMarkdown(reportOf(summary)).includes('INCOMPLETE'), true);
});

test('a run without an end time or without an exit code is unfinished', () => {
  const withoutEnd = forcedRun();
  delete withoutEnd.execution.endTime;
  assert.equal(summariseTurboRun(withoutEnd).reason, 'unfinished');
  const withoutExit = forcedRun();
  delete withoutExit.execution.exitCode;
  assert.equal(summariseTurboRun(withoutExit).reason, 'unfinished');
});

test('anything that is not a summary has the wrong shape', () => {
  assert.equal(summariseTurboRun('nope').reason, 'shape');
  assert.equal(summariseTurboRun(null).reason, 'shape');
  assert.equal(summariseTurboRun({ tasks: [] }).reason, 'shape');
  assert.equal(summariseTurboRun({ execution: {}, tasks: 'nope' }).reason, 'shape');
});

test('a task that ends before it starts has no duration', () => {
  const summary = forcedRun();
  summary.tasks[0].execution.endTime = summary.tasks[0].execution.startTime - 1;
  const run = summariseTurboRun(summary);
  assert.equal(run.tasks[0].durationMs, null);
  assert.equal(run.tasks[0].startTime, 1793646205552);
  assert.equal(run.complete, false);
  assert.equal(run.reason, 'unfinished');
});

test('a replayed task keeps the time it saved and is marked as replayed', () => {
  const run = summariseTurboRun(cachedRun());
  assert.equal(run.tasks[0].timeSavedMs, 3809);
  assert.equal(run.tasks[0].durationMs, 2);
  assert.equal(run.tasks[0].cacheSource, 'LOCAL');
  const markdown = renderMarkdown(reportOf(cachedRun()));
  assert.equal(markdown.includes('replayed'), true);
  assert.equal(markdown.includes('3.809'), true);
});

test('an executed task saves nothing and names no cache source', () => {
  const run = summariseTurboRun(forcedRun());
  assert.equal(run.tasks[0].timeSavedMs, null);
  assert.equal(run.tasks[0].cacheSource, null);
});

test('replayed test tasks are listed once, across the runs', () => {
  const replayed = cachedRun();
  replayed.tasks[0].task = 'test';
  replayed.tasks[0].taskId = '@pospay/ids#test';
  const executed = forcedRun();
  executed.tasks[0].task = 'test';
  executed.tasks[0].taskId = '@pospay/ids#test';
  const unit = cachedRun();
  unit.tasks[0].task = 'test:unit';
  unit.tasks[0].taskId = '@pospay/ids#test:unit';
  const runs = [
    summariseTurboRun(replayed),
    summariseTurboRun(executed),
    summariseTurboRun(unit),
    summariseTurboRun(cachedRun()),
  ];
  assert.deepEqual(replayedTestTasks(runs), ['@pospay/ids#test', '@pospay/ids#test:unit']);
});

test('the header names the label and the commit', () => {
  const commit = 'a'.repeat(40);
  const markdown = renderMarkdown(buildReport({ label: 'check', meta: { commit }, runs: [] }));
  assert.equal(markdown.includes('## CI telemetry · check'), true);
  assert.equal(markdown.includes(commit), true);
});

test('the report lists the replayed test tasks, and none when there are none', () => {
  const replayed = cachedRun();
  replayed.tasks[0].task = 'test';
  replayed.tasks[0].taskId = '@pospay/ids#test';
  const markdown = renderMarkdown(reportOf(replayed));
  assert.equal(markdown.includes('Replayed from cache (not executed in this job):'), true);
  assert.equal(markdown.includes('- @pospay/ids#test'), true);
  const empty = renderMarkdown(buildReport({ label: 'check', meta: {}, runs: [] }));
  assert.equal(empty.includes('- none'), true);
});

test('the markdown escapes a pipe and a newline inside a cell', () => {
  const report = buildReport({ label: 'check', meta: {}, runs: [] });
  const forged = {
    ...report,
    runs: [
      {
        complete: true,
        reason: null,
        attempted: 1,
        cached: 0,
        durationMs: 1000,
        exitCode: 0,
        tasks: [
          {
            taskId: 'a|b\nc',
            cacheStatus: 'MISS',
            durationMs: 1000,
            exitCode: 0,
          },
        ],
      },
    ],
  };
  const markdown = renderMarkdown(forged);
  assert.equal(markdown.includes('a\\|b<br>c'), true);
  assert.equal(markdown.includes('a|b'), false);
});

test('the markdown shows the fifteen slowest tasks and ends with the fixed line', () => {
  const summary = forcedRun();
  summary.execution.attempted = 20;
  summary.tasks = Array.from({ length: 20 }, (unused, index) => ({
    taskId: `@pospay/ids#task-${index}`,
    task: `task-${index}`,
    package: '@pospay/ids',
    cache: { local: false, remote: false, status: 'MISS', timeSaved: 0 },
    execution: { startTime: 1000 + index * 10, endTime: 2000 + index * 100, exitCode: 0 },
    dependencies: [],
  }));
  const markdown = renderMarkdown(reportOf(summary));
  const rows = markdown.split('\n').filter((line) => line.startsWith('| @pospay/ids#task-'));
  assert.equal(rows.length, 15);
  assert.equal(rows[0].includes('task-19'), true);
  const fixed = "Telemetry does not decide whether a step passed; see the step's own result.";
  assert.equal(markdown.trimEnd().endsWith(fixed), true);
});
