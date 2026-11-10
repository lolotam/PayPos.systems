// الأداء الأقصى CI فقط؛ skip محلي ليس PASS، والحدود حواجز تسليم وليست SLO.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { RATING_CLAIM_STATE_SETTLE } from '../rating-claim-state-settle.lua.ts';
import { validationHarness, type ValidationWorld } from './rating-claim-state-harness.fixture.ts';
import { createRatingCiProfiler } from './rating-claim-state-profile.fixture.ts';

const SHA = 'ec26930497f25213b62e2b60bc603af6b9ba3527';
const NAMES = ['validate', 'acquire', 'lease', 'reserve', 'settle', 'sweep'];
const DIRECTORY = 'apps/worker/src/modules/customers/persistence';
const CI = process.env['CI'] === 'true' || process.env['CI'] === '1';
const CAP = 1_048_576;
const LIMITS = { maxBytes: CAP, leaseMs: 120_000, maxTurnMs: 180_000 };
const RETRY_LIMITS = { capacity: 2048, backoffMs: 0, reserveBytes: 65_536 };
const REMOVAL = { retries: 2048, settlement: 'TERMINAL', code: 'OK', nearCap: false };
const CASES = [
  REMOVAL,
  { retries: 2047, settlement: 'RETRY', code: 'OK', nearCap: false },
  { retries: 2048, settlement: 'RETRY', code: 'OVERFLOW', nearCap: false },
  { retries: 2048, settlement: 'TERMINAL', code: 'OK', nearCap: true },
  { retries: 2047, settlement: 'RETRY', code: 'OVERFLOW', nearCap: true },
];
type Scenario = (typeof CASES)[number];
type Lane = ReturnType<typeof validationHarness>;
let scripts: readonly string[];

function command(binary: string, args: readonly string[]) {
  return execFileSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const git = (args: readonly string[]) => command('git', args);
const report = (...data: unknown[]) => console.log(JSON.stringify(data));

/** أساس ثابت؛ فحص المصدر الحرفي يسبق تحميل Node المعزول عن تحويل Vitest. */
function baseline() {
  expect(Number(process.versions.node.split('.')[0])).toBeGreaterThanOrEqual(24);
  try {
    git(['cat-file', '-e', `${SHA}^{commit}`]);
  } catch {
    git(['fetch', '--depth=1', 'origin', SHA]);
  }
  const dir = mkdtempSync(join(tmpdir(), 'rating-887-baseline-'));
  const blobs: Record<string, string> = {};
  try {
    for (const name of NAMES) {
      const filename = `rating-claim-state-${name}.lua.ts`;
      const ref = `${SHA}:${DIRECTORY}/${filename}`;
      const content = git(['show', ref]);
      const symbol = `RATING_CLAIM_STATE_${name.toUpperCase()}`;
      const prefix = content.slice(0, content.indexOf(`export const ${symbol}`));
      const imports =
        name === 'validate'
          ? ''
          : "import { RATING_CLAIM_STATE_VALIDATE } from './rating-claim-state-validate.lua.ts';";
      expect(prefix.replace(/\/\*\*[\s\S]*?\*\//g, '').trim()).toBe(imports);
      const literal = content.slice(prefix.length);
      expect(literal.startsWith(`export const ${symbol} = \``)).toBe(true);
      expect(literal).toMatch(/= `[^`]*`;\s*$/);
      expect(literal.match(/\$\{[^}]*\}/g) ?? []).toEqual(
        name === 'validate' ? [] : ['${RATING_CLAIM_STATE_VALIDATE}'],
      );
      writeFileSync(join(dir, filename), content, { flag: 'wx' });
      blobs[name] = git(['rev-parse', ref]).trim();
    }
    const loader = [
      'let settle;',
      'for (const name of JSON.parse(process.argv[2])) {',
      'const m = await import(new URL(`rating-claim-state-${name}.lua.ts`, process.argv[1]));',
      'const value = m[`RATING_CLAIM_STATE_${name.toUpperCase()}`];',
      'if (typeof value !== "string") throw new Error("BASELINE_EXPORT_INVALID");',
      'if (name === "settle") settle = value; }',
      'process.stdout.write(settle);',
    ].join('\n');
    const args = ['--input-type=module', '-e', loader, pathToFileURL(`${dir}/`).href];
    report({ baseline: SHA, blobs });
    return command(process.execPath, [...args, JSON.stringify(NAMES)]);
  } finally {
    rmSync(dir, { recursive: true });
  }
}

/** نفس state العادي والحد الفعلي؛ الحشو يقرب الحالة من 1MiB دون تغيير الاحتياطي. */
function fixture(world: ValidationWorld, scenario: Scenario, raw: Record<string, unknown>) {
  const state = { ...raw };
  const entries = Array.from({ length: 75 }, (_, i) => ({
    requestId: `req-${String(i).padStart(4, '0')}`,
    workToken: `work-${i}`,
  }));
  const retries = Object.fromEntries(
    Array.from({ length: scenario.retries }, (_, i) => [
      `retry-${i}`,
      { ticket: i + 1, eligibleAt: 0 },
    ]),
  );
  const cursor = entries.at(-1)?.requestId;
  Object.assign(state, {
    retries,
    nextTicket: scenario.retries + 1,
    upperId: 'z',
    cursorId: cursor,
    phase: 'SWEEP',
    sweepId: 'sweep',
    sweepOverflowCount: 0,
    page: {
      pageId: 'page',
      sweepId: 'sweep',
      fromId: '0',
      throughId: cursor,
      exhausted: true,
      entries,
    },
    padding: '',
  });
  if (scenario.nearCap) {
    state['padding'] = 'x'.repeat(CAP - 128 - Buffer.byteLength(JSON.stringify(state)));
  }
  const text = JSON.stringify(state);
  const bytes = Buffer.byteLength(text);
  if (scenario.nearCap) expect(bytes).toBe(CAP - 128);
  const envelope = {
    ...world.fence,
    version: 1,
    action: 'settlePage',
    pageId: 'page',
    workToken: entries[0]?.workToken,
    settlement: scenario.settlement,
    ...LIMITS,
    ...RETRY_LIMITS,
  };
  return { text, bytes, envelope, entries };
}

function stats(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { median: sorted[49], p95: sorted[94], max: Math.max(...samples) };
}

async function wholePage(lane: Lane, scripts: readonly string[]) {
  const { redis, harness, rawStateOf } = lane;
  const world = await harness();
  const data = await fixture(world, REMOVAL, await rawStateOf(world));
  for (const [variant, script] of scripts.entries()) {
    await redis.set(world.key, data.text);
    const started = process.hrtime.bigint();
    for (const [i, { workToken }] of data.entries.entries()) {
      const payload = JSON.stringify({ ...data.envelope, version: i + 1, workToken });
      const commandStarted = process.hrtime.bigint();
      const reply = await redis.eval(script, 1, world.key, payload);
      expect(Number(process.hrtime.bigint() - commandStarted) / 1_000_000).toBeLessThanOrEqual(100);
      expect(JSON.parse(String(reply))).toMatchObject({ code: 'OK', version: i + 2 });
    }
    const elapsed = Number(process.hrtime.bigint() - started) / 1_000_000;
    expect((await world.state.read(world.companyId)).value?.page?.entries).toHaveLength(0);
    report({ variant, settlements: 75, elapsed, bytes: data.bytes });
  }
}

// الـharness والاتصال والـhooks جوه المجموعة؛ التشغيل المحلي لا يتصل بسبب skip.
describe.skipIf(!CI)('CI-only exact counter whole-command performance', () => {
  const lane = validationHarness();
  const { redis, harness, rawStateOf } = lane;
  beforeAll(async () => {
    scripts = [baseline(), RATING_CLAIM_STATE_SETTLE];
    const port = String(redis.options.port);
    const filters = [`publish=${port}`, 'label=com.docker.compose.service=redis'];
    const flags = filters.flatMap((filter) => ['--filter', filter]);
    const container = command('docker', ['ps', '-q', ...flags]).trim();
    expect(container.split('\n')).toHaveLength(1);
    expect(container).not.toBe('');
    const format = '{{.Image}} {{.Config.Image}}';
    const image = command('docker', ['inspect', '--format', format, container]).trim();
    report({ image, server: await redis.info('server'), cpus: cpus().length, load: loadavg() });
  });

  it.each(CASES)('whole settlePage $settlement/$retries nearCap=$nearCap', async (scenario) => {
    const world = await harness();
    const data = await fixture(world, scenario, await rawStateOf(world));
    const profiler = await createRatingCiProfiler(redis);
    const samples: number[][] = [[], []];
    const warmups = [0, 0];
    const expectedRetries =
      scenario.retries + (scenario.code === 'OK' && scenario.settlement === 'RETRY' ? 1 : 0);
    for (let block = 0; block < 12; block += 1) {
      for (const index of block % 2 === 0 ? [0, 1] : [1, 0]) {
        const script = scripts[index];
        if (script === undefined) throw new Error('PERF_VARIANT_MISSING');
        for (let call = 0; call < 10; call += 1) {
          await redis.set(world.key, data.text);
          const payload = JSON.stringify(data.envelope);
          const started = process.hrtime.bigint();
          const raw = await redis.eval(script, 1, world.key, payload);
          const elapsed = Number(process.hrtime.bigint() - started) / 1_000_000;
          profiler?.sample(index, block, call, elapsed);
          expect(JSON.parse(String(raw))).toMatchObject({ code: scenario.code, version: 2 });
          const stored = await rawStateOf(world);
          expect(Object.keys(stored['retries'] as object)).toHaveLength(expectedRetries);
          expect(stored['nextTicket']).toBe(expectedRetries + 1);
          expect((stored['page'] as { entries: unknown[] }).entries).toHaveLength(74);
          expect(stored['overflowCount']).toBe(scenario.code === 'OVERFLOW' ? 1 : 0);
          if (block < 2) warmups[index] = (warmups[index] ?? 0) + 1;
          else samples[index]?.push(elapsed);
        }
        await profiler?.flush();
      }
    }
    expect(warmups).toEqual([20, 20]);
    expect(samples.map((bucket) => bucket.length)).toEqual([100, 100]);
    const base = stats(samples[0] ?? []);
    const patch = stats(samples[1] ?? []);
    const counts = samples.map((bucket) => bucket.length);
    const size = { bytes: data.bytes, headroom: CAP - data.bytes };
    report({ scenario, size, warmups, counts, load: loadavg(), base, patch });
    expect(patch.p95).toBeLessThanOrEqual(50);
    expect(patch.p95).toBeLessThanOrEqual(Math.max(2 * (base.p95 ?? 0), (base.p95 ?? 0) + 5));
    expect(patch.max).toBeLessThanOrEqual(100);
    expect(base.max).toBeLessThanOrEqual(100);
  });

  it('records a whole 75-settlement page for each variant', () => wholePage(lane, scripts));
});
