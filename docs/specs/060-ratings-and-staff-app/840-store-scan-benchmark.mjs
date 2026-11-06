import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../../../', import.meta.url));
const persistence = new URL(
  '../../../apps/worker/src/modules/customers/persistence/',
  import.meta.url,
);
const { RATING_CLAIM_STATE_LEASE } = await import(
  new URL('rating-claim-state-lease.lua.ts', persistence)
);
const { RATING_CLAIM_STATE_VALIDATE } = await import(
  new URL('rating-claim-state-validate.lua.ts', persistence)
);
const redisUrl = new URL(process.argv[2]);
assert.ok(
  ['127.0.0.1', 'localhost', '[::1]'].includes(redisUrl.hostname),
  'Use a private local Redis only',
);
assert.ok(process.argv[3], 'Pass a JSON report output path as the second argument');
const Redis = createRequire(`${cwd}/apps/worker/package.json`)('ioredis');
const redis = new Redis(redisUrl.toString());
const oldHead = '1620b8bb10a0d8a5093cdbcae725dd1cfdb9a047';
const folder = 'apps/worker/src/modules/customers/persistence/';
function literal(file, symbol) {
  const source = execFileSync('git', ['show', `${oldHead}:${folder}${file}`], {
    cwd,
    encoding: 'utf8',
  });
  const match = source.match(new RegExp('export const ' + symbol + ' = `([\\s\\S]*)`;'));
  assert.ok(match);
  return match[1];
}
const oldValidator = literal('rating-claim-state-validate.lua.ts', 'RATING_CLAIM_STATE_VALIDATE');
const baseline = literal('rating-claim-state-lease.lua.ts', 'RATING_CLAIM_STATE_LEASE').replace(
  '${RATING_CLAIM_STATE_VALIDATE}',
  oldValidator,
);
assert.equal(
  RATING_CLAIM_STATE_LEASE.replace('  if not validate_state(state) then return false end\n', ''),
  baseline,
);
const variants = { baseline, postcondition: RATING_CLAIM_STATE_LEASE };
const id = (prefix, index) => `${prefix}-0000-7000-8000-${index.toString(16).padStart(12, '0')}`;
const quantile = (values, fraction) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const stats = (values) => ({
  median: quantile(values, 0.5),
  p95: quantile(values, 0.95),
  samples: values.length,
});
const costScript = `
local MAX_SAFE = 9007199254740991
${RATING_CLAIM_STATE_VALIDATE}
local state = cjson.decode(ARGV[1])
local count = tonumber(ARGV[2])
if not validate_state(state) then return redis.error_reply('BENCH_STATE_INVALID') end
if ARGV[3] == 'scan' then
  for i = 1, count do if not validate_state(state) then return redis.error_reply('BENCH_STATE_INVALID') end end
elseif ARGV[3] == 'encode' then
  for i = 1, count do local encoded = cjson.encode(state) end
end
return 'OK'
`;
async function evalStats() {
  const line = (await redis.info('commandstats')).match(/^cmdstat_evalsha:calls=(\d+),usec=(\d+)/m);
  assert.ok(line);
  return { calls: Number(line[1]), usec: Number(line[2]) };
}
const report = {
  baselineHead: oldHead,
  node: process.version,
  transport: '127.0.0.1 private Redis / EVALSHA',
  warmupPairs: 10,
  measuredPairs: 100,
  pureCostBatches: 20,
  iterationsPerBatch: 25,
  scriptSha1: Object.fromEntries(
    Object.entries(variants).map(([k, v]) => [k, createHash('sha1').update(v).digest('hex')]),
  ),
  cases: [],
};
const keys = [];
try {
  report.redisVersion = (await redis.info('server')).match(/^redis_version:([^\r\n]+)/m)?.[1];
  const shas = Object.fromEntries(
    await Promise.all(
      Object.entries(variants).map(async ([name, script]) => [
        name,
        await redis.script('LOAD', script),
      ]),
    ),
  );
  const pureSha = await redis.script('LOAD', costScript);
  for (const spec of [
    { name: 'idle-empty', retries: 0, page: 0 },
    { name: 'typical-64', retries: 64, page: 25 },
    { name: 'capacity-2048', retries: 2048, page: 75 },
  ]) {
    const key = `pospay-840-scan-bench-${randomUUID()}`;
    keys.push(key);
    const [seconds, micros] = await redis.time();
    const now = Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
    const companyId = randomUUID(),
      incarnation = randomUUID(),
      ownerToken = randomUUID();
    const state = {
      schema: 1,
      companyId,
      incarnation,
      version: 1,
      ownerToken,
      leaseUntil: now + 120000,
      turnStartedAt: now,
      nextTicket: spec.retries + 1,
      phase: spec.page ? 'SWEEP' : 'IDLE',
      retries: {},
      overflowCount: 0,
      reconcileRequired: false,
      sweepOverflowCount: 0,
    };
    for (let n = 1; n <= spec.retries; n++)
      state.retries[id('019c0000', n)] = {
        ticket: n,
        eligibleAt: now - 1000,
        ...(n <= 25 ? { ownerToken, leaseUntil: now + 120000, workToken: id('019e0000', n) } : {}),
      };
    if (spec.page)
      Object.assign(state, {
        sweepId: randomUUID(),
        upperId: id('019b0000', spec.page + 10),
        cursorId: id('019b0000', spec.page),
        page: {
          pageId: randomUUID(),
          sweepId: null,
          throughId: id('019b0000', spec.page),
          exhausted: false,
          entries: Array.from({ length: spec.page }, (_, n) => ({
            requestId: id('019b0000', n + 1),
            workToken: id('019d0000', n + 1),
          })),
        },
      });
    if (state.page) state.page.sweepId = state.sweepId;
    const raw = JSON.stringify(state);
    const payload = JSON.stringify({
      companyId,
      incarnation,
      ownerToken,
      version: 1,
      action: 'renew',
      leaseMs: 120000,
      maxTurnMs: 180000,
      maxBytes: 1048576,
    });
    const times = { baseline: [], postcondition: [] },
      paired = [];
    for (let n = -report.warmupPairs; n < report.measuredPairs; n++) {
      const current = {};
      for (const variant of n % 2 === 0
        ? ['baseline', 'postcondition']
        : ['postcondition', 'baseline']) {
        await redis.set(key, raw);
        const start = performance.now();
        const result = await redis.evalsha(shas[variant], 1, key, payload);
        current[variant] = performance.now() - start;
        const decoded = JSON.parse(result);
        assert.equal(decoded.code, 'OK');
        assert.equal(decoded.version, 2);
        if (n >= 0) times[variant].push(current[variant]);
      }
      if (n >= 0) paired.push(current.postcondition - current.baseline);
    }
    const pure = { scan: [], encode: [] };
    for (let batch = 0; batch < report.pureCostBatches; batch++) {
      const costs = {};
      for (const phase of batch % 2 === 0
        ? ['noop', 'scan', 'encode']
        : ['encode', 'scan', 'noop']) {
        const before = await evalStats();
        assert.equal(await redis.evalsha(pureSha, 0, raw, report.iterationsPerBatch, phase), 'OK');
        const after = await evalStats();
        assert.equal(
          after.calls - before.calls,
          1,
          'No concurrent EVALSHA may contaminate commandstats',
        );
        costs[phase] = after.usec - before.usec;
      }
      for (const phase of ['scan', 'encode'])
        pure[phase].push((costs[phase] - costs.noop) / report.iterationsPerBatch);
    }
    const row = {
      ...spec,
      reserved: Math.min(25, spec.retries),
      jsonBytes: Buffer.byteLength(raw),
      roundTripMs: {
        baseline: stats(times.baseline),
        postcondition: stats(times.postcondition),
        pairedDelta: stats(paired),
      },
      luaMicrosPerOperation: { scan: stats(pure.scan), encode: stats(pure.encode) },
    };
    report.cases.push(row);
    console.log(JSON.stringify(row));
  }
  report.note =
    'Same valid bytes reset outside timed EVALSHA; alternating paired order. Client round trip includes transport and reply, excludes reset/parse. Pure loop costs use Redis INFO commandstats EVALSHA microseconds, subtract same decode/prevalidation/noop script and divide by 25. Each before/after pair asserts exactly one EVALSHA. Redis TIME was observed constant inside one script, so its zero-duration attempt was discarded. Local private-container measurements, not a production latency guarantee.';
  fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
} finally {
  if (keys.length) await redis.del(...keys);
  await redis.quit();
}
