import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chromium } from 'playwright-core';
import { expect, it, vi } from 'vitest';

import type { PdfBrowser } from '../playwright/browser.ts';
import { getLaunchCleanup, killAndWait, playwrightFactory, withLaunchCleanup } from '../playwright/factory.ts';
import { isPidAlive } from '../playwright/process-tree.ts';
import { PlaywrightDocumentRenderer } from '../playwright/renderer.ts';
import { dropRetiredBrowser } from '../playwright/retire.ts';
import { realChromiumUnavailable } from './chromium-gate.ts';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function fakeBrowser(overrides: Partial<PdfBrowser> = {}): PdfBrowser {
  return { newContext: () => new Promise(() => undefined), close: () => new Promise(() => undefined), on: () => undefined, ...overrides };
}

// kill() بيوصل لعملية Chromium من جوّه Playwright؛ الاختبار ده بيثبت إنه لسه شغال على 1.63.0.
const browser = await playwrightFactory()
  .launch()
  .catch((error: unknown) => realChromiumUnavailable(error));

it.skipIf(browser === false)('kill() terminates the real Chromium process', async () => {
  if (browser === false) return;
  const gone = new Promise<void>((resolve) => {
    browser.on('disconnected', () => {
      resolve();
    });
  });
  expect(browser.kill).toBeTypeOf('function');
  await expect(Promise.resolve(browser.kill?.())).resolves.toBeUndefined();
  await expect(gone).resolves.toBeUndefined();
});

it.skipIf(browser === false)('attaches launch cleanup when pinned Playwright launcher fails after spawn', async () => {
  const pw = chromium as unknown as {
    _connection: { toImpl: (target: unknown) => { connectToTransport: (...a: unknown[]) => Promise<unknown> } };
  };
  const impl = pw._connection.toImpl(chromium);
  const orig = impl.connectToTransport;
  impl.connectToTransport = async () => { throw new Error('POST_SPAWN_TEST_FAIL'); };
  let caught: unknown;
  try {
    await playwrightFactory().launch();
  } catch (err) {
    caught = err;
  } finally {
    impl.connectToTransport = orig;
  }
  expect(caught).toBeInstanceOf(Error);
  const cleanup = getLaunchCleanup(caught);
  expect(cleanup).toBeDefined();
  await expect(cleanup).resolves.toBeUndefined();
});

it('keeps replacement launches blocked on rejected launch cleanup before and after timeout until retry confirms', async () => {
  for (const [timeoutMs, delayMs] of [[200, 0], [15, 35]] as const) {
    let launches = 0;
    let kills = 0;
    const errors: string[] = [];
    const renderer = new PlaywrightDocumentRenderer({
      factory: {
        launch: () => new Promise((_, reject) => {
          launches += 1;
          setTimeout(() => reject(withLaunchCleanup(new Error('spawn fail'), Promise.reject(new Error('SIGKILL_REJECTED')), () => { kills += 1; })), delayMs);
        }),
      },
      launchTimeoutMs: timeoutMs,
      sleep: wait,
      backoffMs: [250],
      onLaunchError: (err) => { if (err instanceof Error) errors.push(err.message); },
    });
    await renderer.start();
    await wait(delayMs + 40);
    expect(launches).toBe(1);
    expect(errors).toContain('SIGKILL_REJECTED');
    expect(renderer.unconfirmedExit).not.toBeNull();
    await Promise.resolve(renderer.kill());
    expect(kills).toBe(1);
    expect(renderer.unconfirmedExit).toBeNull();
  }
});

it('retries failed launch cleanup automatically on backoff and relaunches once confirmed', async () => {
  let launches = 0;
  let kills = 0;
  const errors: string[] = [];
  const renderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: () => {
        launches += 1;
        if (launches > 1) return Promise.resolve(fakeBrowser({ close: () => Promise.resolve() }));
        return Promise.reject(withLaunchCleanup(new Error('spawn fail'), Promise.reject(new Error('SIGKILL_REJECTED')), () => {
          kills += 1;
          if (kills === 1) throw new Error('EPERM');
        }));
      },
    },
    launchTimeoutMs: 200,
    sleep: wait,
    backoffMs: [10, 10],
    onLaunchError: (err) => { if (err instanceof Error) errors.push(err.message); },
  });
  await renderer.start();
  for (let i = 0; i < 40 && !renderer.isAvailable(); i += 1) await wait(10);
  expect(renderer.isAvailable()).toBe(true);
  expect(launches).toBe(2);
  expect(kills).toBe(2);
  expect(errors).toEqual(expect.arrayContaining(['SIGKILL_REJECTED', 'EPERM']));
  expect(renderer.unconfirmedExit).toBeNull();
  await renderer.close();
});

it('unblocks a hung launch cleanup gate as soon as retryKill confirms', async () => {
  let kills = 0;
  let launches = 0;
  const renderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: () => {
        launches += 1;
        return launches === 1
          ? Promise.reject(withLaunchCleanup(new Error('hung'), new Promise<void>(() => undefined), () => { kills += 1; }))
          : Promise.resolve(fakeBrowser({ close: () => Promise.resolve() }));
      },
    },
    launchTimeoutMs: 200,
    sleep: wait,
    backoffMs: [10],
  });
  await renderer.start();
  for (let i = 0; i < 40 && !renderer.isAvailable(); i += 1) await wait(10);
  expect(renderer.isAvailable()).toBe(true);
  expect(kills).toBe(1);
  expect(launches).toBe(2);
  expect(renderer.unconfirmedExit).toBeNull();
  await renderer.close();
});

it('unblocks relaunch when initial cleanup resolves after a hung retryKill', async () => {
  let kills = 0;
  let launches = 0;
  const renderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: () => {
        launches += 1;
        return launches === 1
          ? Promise.reject(withLaunchCleanup(new Error('slow cleanup'), wait(35), () => {
            kills += 1;
            return new Promise<void>(() => undefined);
          }))
          : Promise.resolve(fakeBrowser({ close: () => Promise.resolve() }));
      },
    },
    launchTimeoutMs: 200,
    sleep: wait,
    backoffMs: [10],
  });
  await renderer.start();
  for (let i = 0; i < 40 && !renderer.isAvailable(); i += 1) await wait(10);
  expect(renderer.isAvailable()).toBe(true);
  expect(kills).toBe(1);
  expect(launches).toBe(2);
  expect(renderer.unconfirmedExit).toBeNull();
  await renderer.close();
});

it('retries failed retirement kill on backoff and relaunches once confirmed', async () => {
  let launches = 0;
  let kills = 0;
  const errors: string[] = [];
  const renderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: () => {
        launches += 1;
        if (launches > 1) return Promise.resolve(fakeBrowser({ close: () => Promise.resolve() }));
        return Promise.resolve(fakeBrowser({
          kill: () => {
            kills += 1;
            if (kills <= 2) return Promise.reject(new Error('RETIRE_KILL_EPERM'));
            return Promise.resolve();
          },
        }));
      },
    },
    sleep: wait,
    backoffMs: [10, 10, 10],
    overallTimeoutMs: 15,
    browserCloseGraceMs: 10,
    onLaunchError: (err) => { if (err instanceof Error) errors.push(err.message); },
  });
  await renderer.start();
  await expect(renderer.render('<p>x</p>')).rejects.toThrow();
  for (let i = 0; i < 80 && !renderer.isAvailable(); i += 1) await wait(10);
  expect(renderer.isAvailable()).toBe(true);
  expect(kills).toBe(3);
  expect(launches).toBe(2);
  expect(errors).toEqual(expect.arrayContaining(['DOCUMENT_RETIRE_UNCONFIRMED', 'RETIRE_KILL_EPERM']));
  expect(renderer.unconfirmedExit).toBeNull();
  await renderer.close();
});

it('keeps killProcessTree pending for surviving descendants when root has already exited', async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null, kill: () => true });
  const root = Object.assign(new EventEmitter(), { exitCode: 0, signalCode: null, children: [child], kill: () => true });
  let done = false;
  const waiting = Promise.resolve(killAndWait(root)).then(() => { done = true; });
  await wait(20);
  expect(done).toBe(false);
  child.exitCode = 0;
  child.emit('exit');
  await waiting;
  expect(done).toBe(true);
});

function assertChildPid<T extends { pid?: number | undefined }>(proc: T): asserts proc is T & { pid: number } {
  if (typeof proc.pid !== 'number') throw new Error('EXPECTED_CHILD_PID');
}

const raceKill = (target: NonNullable<Parameters<typeof killAndWait>[0]>): Promise<string> =>
  Promise.race([Promise.resolve(killAndWait(target)).then(() => 'resolved', (e: unknown) => (e instanceof Error ? e.message : 'rejected')), wait(500).then(() => 'HUNG')]);

function spawnDetachedParent(count: number) {
  const defs = Array.from({ length: count }, (_, i) => `c${i}=spawn(process.execPath,["-e","setTimeout(()=>{},30000)"],{detached:true,stdio:"ignore"})`).join(',');
  const out = Array.from({ length: count }, (_, i) => `c${i}.pid`).join(',');
  const script = `const {spawn}=require("node:child_process"),${defs};process.stdout.write([${out}].join(",")+"\\n");setTimeout(()=>{},30000);`;
  const proc = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  assertChildPid(proc);
  return proc;
}

function readChildPids(proc: ReturnType<typeof spawnDetachedParent>): Promise<number[]> {
  let buf = '';
  return new Promise<number[]>((resolve, reject) => {
    proc.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      if (!buf.includes('\n')) return;
      const pids = buf.trim().split(',').map(Number);
      if (pids.every((p) => Number.isInteger(p) && p > 0)) resolve(pids);
      else reject(new Error(`INVALID_PID:${buf}`));
    });
    proc.once('error', reject);
  });
}

it('rejects promptly when a live root fails SIGKILL without hanging on root pid exit', async () => {
  const hold = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { stdio: 'ignore' });
  try {
    assertChildPid(hold);
    const root = Object.assign(new EventEmitter(), { pid: hold.pid, exitCode: null as number | null, signalCode: null, kill: () => false });
    expect(await raceKill(root)).toBe('SIGKILL_REJECTED');
  } finally { hold.kill('SIGKILL'); }
});

it.runIf(process.platform === 'linux')('terminates detached Linux descendants outside the root process group', async () => {
  const parent = spawnDetachedParent(1);
  let childPid = 0;
  try {
    [childPid = 0] = await readChildPids(parent);
    await Promise.resolve(killAndWait(parent));
    expect(isPidAlive(childPid)).toBe(false);
  } finally {
    if (childPid > 0) try { process.kill(childPid, 'SIGKILL'); } catch { /* exited */ }
    try { parent.kill('SIGKILL'); } catch { /* exited */ }
  }
});

it.runIf(process.platform === 'linux')('propagates non-ESRCH errors when signaling discovered descendants', async () => {
  const parent = spawnDetachedParent(2);
  let pids: number[] = [];
  const origKill = process.kill.bind(process);
  try {
    pids = await readChildPids(parent);
    const [child1Pid = 0, child2Pid = 0] = pids;
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, sig?: string | number) => {
      if (sig === 'SIGKILL' && (pid === child1Pid || pid === -child1Pid)) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      return origKill(pid, sig);
    }) as typeof process.kill);
    expect(await raceKill(parent)).toBe('EPERM');
    expect(isPidAlive(child1Pid)).toBe(true);
    expect(isPidAlive(child2Pid)).toBe(false);
    vi.restoreAllMocks();
    await Promise.resolve(killAndWait(parent));
    expect(isPidAlive(child1Pid)).toBe(false);
  } finally {
    vi.restoreAllMocks();
    for (const pid of pids) if (pid > 0) try { origKill(pid, 'SIGKILL'); } catch { /* exited */ }
    try { parent.kill('SIGKILL'); } catch { /* exited */ }
  }
});

const closedBrowser = (overrides: Partial<PdfBrowser> = {}): PdfBrowser => fakeBrowser({ close: () => Promise.resolve(), ...overrides });
const waitUntil = async (fn: () => boolean, limit = 40): Promise<void> => { for (let i = 0; i < limit && !fn(); i += 1) await wait(10); };

it('preserves recovery across aborted starts, handles reentrant kill inside factory, and shares reentrant kill results', async () => {
  let launches = 0;
  let releaseRetireKill: (() => void) | undefined;
  const retireRenderer = new PlaywrightDocumentRenderer({
    factory: { launch: async () => (++launches === 1 ? fakeBrowser({ kill: () => new Promise<void>((r) => (releaseRetireKill = r)) }) : closedBrowser()) },
    sleep: wait, backoffMs: [0], overallTimeoutMs: 15, browserCloseGraceMs: 10,
  });
  await retireRenderer.start();
  await expect(retireRenderer.render('<p>x</p>')).rejects.toThrow();
  await wait(30);
  const ac1 = new AbortController();
  const s1 = retireRenderer.start({ signal: ac1.signal });
  ac1.abort();
  await s1;
  const ac2 = new AbortController();
  const s2 = retireRenderer.start({ signal: ac2.signal });
  releaseRetireKill?.();
  await wait(15);
  ac2.abort();
  await s2;
  await waitUntil(() => launches >= 2, 30);
  expect(launches).toBe(2);
  await retireRenderer.close();

  let releaseLate!: (b: PdfBrowser) => void;
  let releaseLateClose!: () => void;
  let reentrantKill: Promise<void> | undefined;
  let lateClosed = false;
  const rr = new PlaywrightDocumentRenderer({ factory: { launch: () => { reentrantKill = Promise.resolve(rr.kill()); return new Promise((r) => (releaseLate = r)); } }, closeGraceMs: 20 });
  const pendingStart = rr.start();
  await wait(10);
  releaseLate(fakeBrowser({ close: () => new Promise<void>((r) => { releaseLateClose = () => { lateClosed = true; r(); }; }) }));
  let reentrantDone = false;
  void reentrantKill?.then(() => { reentrantDone = true; });
  await wait(15);
  expect(reentrantDone).toBe(false);
  releaseLateClose();
  await Promise.all([pendingStart, reentrantKill]);
  expect(lateClosed).toBe(true);

  let releaseInner!: () => void;
  let innerKill: void | Promise<void> = undefined;
  const shared = new PlaywrightDocumentRenderer({ factory: { launch: async () => fakeBrowser({ kill: () => { innerKill = shared.kill(); return new Promise<void>((r) => (releaseInner = r)); } }) } });
  await shared.start();
  const outerKill = shared.kill();
  expect(innerKill).toBeInstanceOf(Promise);
  let innerDone = false;
  void Promise.resolve(innerKill).then(() => { innerDone = true; });
  await wait(15);
  expect(innerDone).toBe(false);
  releaseInner();
  await Promise.all([outerKill, innerKill]);
  expect(innerDone).toBe(true);
});

it('retains shutdown handle for abandoned late browsers, escalates late cleanup, and handles undefined kill rejections', async () => {
  let releaseLate!: (b: PdfBrowser) => void;
  let kills = 0;
  const renderer = new PlaywrightDocumentRenderer({ factory: { launch: () => new Promise((r) => (releaseLate = r)) }, launchTimeoutMs: 15, closeGraceMs: 15 });
  await renderer.start();
  releaseLate(fakeBrowser({ kill: () => (++kills === 1 ? Promise.reject() : Promise.resolve()) }));
  await wait(40);
  expect(renderer.unconfirmedExit).not.toBeNull();
  await Promise.resolve(renderer.kill());
  expect(kills).toBe(2);
  expect(renderer.unconfirmedExit).toBeNull();

  let releaseDropClose!: () => void;
  let dropKills = 0;
  const undefRejected = await dropRetiredBrowser(fakeBrowser({ close: () => new Promise<void>((r) => (releaseDropClose = r)), kill: () => { dropKills += 1; return Promise.reject(); } }), 15);
  expect(dropKills).toBe(1);
  expect(undefRejected.confirmed).toBe(false);
  releaseDropClose();
  await undefRejected.exit;

  let rejectCleanup!: (err: Error) => void;
  let escalatedKills = 0;
  const lateRenderer = new PlaywrightDocumentRenderer({ factory: { launch: () => new Promise((_, reject) => { rejectCleanup = reject; }) }, backoffMs: [10] });
  const starting = lateRenderer.start();
  const killing = Promise.resolve(lateRenderer.kill());
  let killSettled = false;
  void killing.then(() => { killSettled = true; });
  await wait(15);
  expect(killSettled).toBe(false);
  rejectCleanup(withLaunchCleanup(new Error('late'), Promise.reject(new Error('SIGKILL_REJECTED')), () => (++escalatedKills === 1 ? Promise.reject(new Error('EPERM')) : Promise.resolve())));
  await Promise.all([starting, killing]);
  expect(escalatedKills).toBe(2);
  expect(lateRenderer.unconfirmedExit).toBeNull();
});

it('keeps retirement gated on failed descendant kill after browser.close resolves and gates disconnect launches', async () => {
  let childKills = 0;
  let launches = 0;
  let releaseClose!: () => void;
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null, kill: () => (++childKills === 1 ? (() => { throw new Error('EPERM'); })() : true) });
  const root = Object.assign(new EventEmitter(), { exitCode: 0, signalCode: null, children: [child], kill: () => true });
  const r1 = new PlaywrightDocumentRenderer({ factory: { launch: async () => (++launches === 1 ? fakeBrowser({ close: () => new Promise<void>((r) => (releaseClose = r)), kill: () => killAndWait(root) }) : closedBrowser()) }, sleep: wait, backoffMs: [250], overallTimeoutMs: 15, browserCloseGraceMs: 10 });
  await r1.start();
  await expect(r1.render('<p>x</p>')).rejects.toThrow();
  await wait(25);
  expect(childKills).toBe(1);
  releaseClose();
  await wait(25);
  expect(launches).toBe(1);
  expect(r1.unconfirmedExit).not.toBeNull();
  const retry = Promise.resolve(r1.kill());
  await wait(10);
  expect(childKills).toBe(2);
  child.exitCode = 0;
  child.emit('exit');
  await retry;
  expect(r1.unconfirmedExit).toBeNull();

  let dcLaunches = 0;
  let disconnect!: () => void;
  let releaseDcClose!: () => void;
  const r2 = new PlaywrightDocumentRenderer({ factory: { launch: async () => (++dcLaunches === 1 ? fakeBrowser({ close: () => new Promise<void>((r) => (releaseDcClose = r)), on: (ev, cb) => { if (ev === 'disconnected') disconnect = cb; } }) : closedBrowser()) }, backoffMs: [5] });
  await r2.start();
  disconnect();
  await wait(30);
  expect(dcLaunches).toBe(1);
  expect(r2.isAvailable()).toBe(false);
  releaseDcClose();
  await waitUntil(() => r2.isAvailable());
  expect(dcLaunches).toBe(2);
  expect(r2.isAvailable()).toBe(true);
  await r2.close();
});
