import { strict as assert } from 'node:assert';
import { readFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseDockerStats } from './load-parser.mjs';
import { createLoadJournal } from './load-journal.mjs';

const raw = readFileSync(new URL('./fixtures/42-3b1-docker-stats.raw', import.meta.url));
const container = 'pospay-load-capture-2521344c';
const options = { container, minSamples: 2 };
const plain = () =>
  raw.toString().replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*[HJKm]', 'g'), '');

function cleanup(directory) {
  const absolute = realpathSync(directory);
  assert.ok(
    absolute
      .toLowerCase()
      .startsWith(join(realpathSync(tmpdir()), 'pospay-load-journal-').toLowerCase()),
  );
  rmSync(absolute, { recursive: true, force: true });
}

test('captured Docker bytes reproduce the old parser failure; ANSI and plain JSON retain identical load', () => {
  assert.throws(() => raw.toString().trim().split('\n').map(JSON.parse), SyntaxError);
  const records = parseDockerStats(raw, options);
  assert.ok(records.length >= 2);
  assert.deepEqual(records, parseDockerStats(Buffer.from(plain()), options));
  assert.equal(records[0].Name, container);
  const high = JSON.stringify({ ...records[0], CPUPerc: '999.00%' }) + '\n';
  assert.equal(parseDockerStats(Buffer.from(high.repeat(2)), options)[0].CPUPerc, '999.00%');
});

test('rejects malformed, truncated, empty, wrong-container and missing-field evidence', () => {
  const lines = plain().trim().split('\n').filter(Boolean);
  for (const value of [
    '',
    '\x1b[H\n',
    '{bad}\n',
    lines[0],
    plain() + '{',
    plain() + '{bad}\n',
    Buffer.from([255, 10]),
  ]) {
    assert.throws(() => parseDockerStats(Buffer.from(value), options));
  }
  assert.throws(() => parseDockerStats(raw, { ...options, container: 'another-container' }));
  const row = JSON.parse(lines[0]);
  for (const field of ['CPUPerc', 'MemPerc', 'MemUsage', 'BlockIO', 'NetIO', 'ID']) {
    const broken = Object.fromEntries(Object.entries(row).filter(([key]) => key !== field));
    assert.throws(() =>
      parseDockerStats(Buffer.from((JSON.stringify(broken) + '\n').repeat(2)), options),
    );
  }
  for (const value of ['NaN%', '-1%', 'Infinity%', 'hidden']) {
    assert.throws(() =>
      parseDockerStats(
        Buffer.from((JSON.stringify({ ...row, CPUPerc: value }) + '\n').repeat(2)),
        options,
      ),
    );
  }
  assert.throws(() =>
    parseDockerStats(Buffer.from(plain().replace('{', '\x1b]unexpected{')), options),
  );
});

test('raw chunks and completed sale survive parse failure; incomplete evidence remains rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pospay-load-journal-'));
  try {
    const journal = createLoadJournal(directory, options);
    journal.sale({ trial: 0, elapsed: 999, phases: [{ label: 'commit_and_return', ms: 20 }] });
    for (let offset = 0; offset < raw.length; offset += 7)
      journal.stdout(raw.subarray(offset, offset + 7));
    journal.stdout(Buffer.from('{broken}\n'));
    journal.stderr(Buffer.from('diagnostic stderr'));
    assert.throws(() =>
      journal.finish({ expectedSales: 1, hostSamples: [{ cpu: 50, free: 1000 }] }),
    );
    assert.deepEqual(
      readFileSync(join(directory, 'docker.stdout.raw')),
      Buffer.concat([raw, Buffer.from('{broken}\n')]),
    );
    assert.equal(
      JSON.parse(readFileSync(join(directory, 'sales.jsonl'), 'utf8').trim()).elapsed,
      999,
    );
    assert.equal(JSON.parse(readFileSync(join(directory, 'status.json'))).accepted, false);
    assert.throws(() => createLoadJournal(directory, options));
    assert.throws(() => journal.finish({ expectedSales: 1, hostSamples: [] }));
  } finally {
    cleanup(directory);
  }
});

test('complete evidence succeeds, preserving timing failure and host load without threshold logic', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pospay-load-journal-'));
  try {
    const journal = createLoadJournal(directory, options);
    for (let offset = 0; offset < raw.length; offset += 7)
      journal.stdout(raw.subarray(offset, offset + 7));
    journal.sale({ trial: 0, elapsed: 999, phases: [] });
    journal.host({ cpu: 20, free: 1000 });
    journal.host({ cpu: 90, free: 500 });
    const result = journal.finish({ expectedSales: 1, streamClosed: true });
    assert.equal(result.sales[0].elapsed, 999);
    assert.deepEqual(
      result.host.map((s) => s.cpu),
      [20, 90],
    );
    assert.equal(JSON.parse(readFileSync(join(directory, 'status.json'))).accepted, true);
    assert.throws(() => journal.stdout(Buffer.from('extra')));
  } finally {
    cleanup(directory);
  }
});

test('missing host/sale coverage and unexpected Docker termination fail closed with raw retained', () => {
  for (const condition of ['host', 'sale', 'stream', 'stderr']) {
    const directory = mkdtempSync(join(tmpdir(), 'pospay-load-journal-'));
    try {
      const journal = createLoadJournal(directory, options);
      journal.stdout(raw);
      if (condition !== 'sale') journal.sale({ trial: 0, elapsed: 999, phases: [] });
      if (condition !== 'host') {
        journal.host({ cpu: 20, free: 1000 });
        journal.host({ cpu: 30, free: 800 });
      }
      if (condition === 'stderr') journal.stderr(Buffer.from('connection refused'));
      assert.throws(() =>
        journal.finish({ expectedSales: 1, streamClosed: condition !== 'stream' }),
      );
      assert.deepEqual(readFileSync(join(directory, 'docker.stdout.raw')), raw);
      assert.equal(JSON.parse(readFileSync(join(directory, 'status.json'))).accepted, false);
    } finally {
      cleanup(directory);
    }
  }
});
