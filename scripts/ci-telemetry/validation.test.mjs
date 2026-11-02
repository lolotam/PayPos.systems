import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const sample = () => ({
  turboVersion: '2.11.2',
  execution: {
    success: 1,
    failed: 0,
    cached: 0,
    attempted: 1,
    startTime: 0,
    endTime: 1,
    exitCode: 0,
  },
  tasks: [
    {
      taskId: '@pospay/ids#build',
      task: 'build',
      package: '@pospay/ids',
      dependencies: [],
      cache: { status: 'MISS', timeSaved: 0 },
      execution: { startTime: 0, endTime: 1, exitCode: 0 },
    },
  ],
});

test('malformed required fields and absent execution stay visible through the CLI', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'ci-telemetry-validation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runs = join(root, 'runs');
  mkdirSync(runs);
  const mutations = [
    ['turboVersion', undefined],
    ['execution.cached', -1],
    ['execution.failed', 1, 'count-mismatch'],
    ['tasks.0.cache.status', 'PARTIAL'],
    ['tasks.0.cache.status', undefined],
    ['tasks.0.taskId', '@pospay/ids#other'],
    ['tasks.0.dependencies', ['invalid']],
    ['tasks.0.cache.timeSaved', undefined],
    ['tasks.0.cache', { status: 'HIT', timeSaved: 0 }],
    ['tasks.0.cache', { status: 'HIT', source: 'LOCAL', timeSaved: -1 }],
    ['tasks.0.execution.exitCode', '0'],
    ['tasks.0.execution', undefined, 'unfinished'],
  ];
  for (const [field, value, reason = 'malformed'] of mutations) {
    const raw = sample();
    const path = field.split('.');
    const key = path.pop();
    path.reduce((node, part) => node[part], raw)[key] = value;
    writeFileSync(join(runs, 'a.json'), JSON.stringify(raw));
    const env = {
      ...process.env,
      CI_TELEMETRY_CHECKOUT_SHA: 'a'.repeat(40),
      GITHUB_SHA: 'b'.repeat(40),
    };
    delete env.GITHUB_STEP_SUMMARY;
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('./cli.mjs', import.meta.url)),
        '--label',
        'check',
        '--turbo-runs',
        runs,
        '--out',
        root,
      ],
      { encoding: 'utf8', env },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(join(root, 'check.json'), 'utf8'));
    assert.equal(report.runs.length, 1);
    assert.equal(report.runs[0].tasks.length, 1);
    assert.equal(report.runs[0].complete, false);
    assert.equal(report.runs[0].reason, reason);
    assert.equal(report.meta.commit, 'a'.repeat(40));
    assert.match(readFileSync(join(root, 'check.md'), 'utf8'), /INCOMPLETE turbo run 1/);
  }
});
