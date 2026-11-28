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

it('rejects promptly when a live root fails SIGKILL without hanging on root pid exit', async () => {
  const hold = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { stdio: 'ignore' });
  try {
    assertChildPid(hold);
    const root = Object.assign(new EventEmitter(), {
      pid: hold.pid,
      exitCode: null as number | null,
      signalCode: null,
      kill: () => false,
    });
    const outcome = await Promise.race([
      Promise.resolve(killAndWait(root)).then(() => 'resolved', (err: unknown) => (err instanceof Error ? err.message : 'rejected')),
      wait(500).then(() => 'HUNG'),
    ]);
    expect(outcome).toBe('SIGKILL_REJECTED');
  } finally {
    hold.kill('SIGKILL');
  }
});

it.runIf(process.platform === 'linux')('terminates detached Linux descendants outside the root process group', async () => {
  const script = 'const { spawn } = require("node:child_process"); const c = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { detached: true, stdio: "ignore" }); process.stdout.write(String(c.pid) + "\\n"); setTimeout(() => {}, 30000);';
  const parent = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  let childPid = 0;
  try {
    assertChildPid(parent);
    childPid = await new Promise<number>((resolve, reject) => {
      parent.stdout.once('data', (chunk: Buffer) => resolve(Number(chunk.toString('utf8').trim())));
      parent.once('error', reject);
    });
    await Promise.resolve(killAndWait(parent));
    expect(isPidAlive(childPid)).toBe(false);
  } finally {
    if (childPid > 0) {
      try { process.kill(childPid, 'SIGKILL'); } catch { /* exited */ }
    }
    try { parent.kill('SIGKILL'); } catch { /* exited */ }
  }
});

it.runIf(process.platform === 'linux')('propagates non-ESRCH errors when signaling discovered descendants', async () => {
  const script = 'const { spawn } = require("node:child_process"); const c1 = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { detached: true, stdio: "ignore" }); const c2 = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { detached: true, stdio: "ignore" }); process.stdout.write(`${c1.pid},${c2.pid}\\n`); setTimeout(() => {}, 30000);';
  const parent = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  let child1Pid = 0;
  let child2Pid = 0;
  const origKill = process.kill.bind(process);
  try {
    assertChildPid(parent);
    let buf = '';
    [child1Pid, child2Pid] = await new Promise<[number, number]>((resolve, reject) => {
      parent.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        if (!buf.includes('\n')) return;
        const parts = buf.trim().split(',').map(Number);
        resolve([parts[0] ?? 0, parts[1] ?? 0]);
      });
      parent.once('error', reject);
    });
    vi.spyOn(process, 'kill').mockImplementation(((pid: number, sig?: string | number) => {
      if (sig === 'SIGKILL' && (pid === child1Pid || pid === -child1Pid)) {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      }
      return origKill(pid, sig);
    }) as typeof process.kill);
    const outcome = await Promise.race([
      Promise.resolve(killAndWait(parent)).then(() => 'resolved', (err: unknown) => (err instanceof Error ? err.message : 'rejected')),
      wait(500).then(() => 'HUNG'),
    ]);
    expect(outcome).toBe('EPERM');
    expect(isPidAlive(child1Pid)).toBe(true);
    expect(isPidAlive(child2Pid)).toBe(false);
  } finally {
    vi.restoreAllMocks();
    for (const pid of [child1Pid, child2Pid]) {
      if (pid > 0) {
        try { origKill(pid, 'SIGKILL'); } catch { /* exited */ }
      }
    }
    try { parent.kill('SIGKILL'); } catch { /* exited */ }
  }
});

it('preserves recovery across aborted starts, handles reentrant kill inside factory, and retries undefined kill rejections', async () => {
  let launches = 0;
  let releaseRetireKill: (() => void) | undefined;
  const retireRenderer = new PlaywrightDocumentRenderer({
    factory: { launch: async () => (++launches === 1 ? fakeBrowser({ kill: () => new Promise<void>((r) => (releaseRetireKill = r)) }) : fakeBrowser({ close: async () => undefined })) },
    sleep: wait,
    backoffMs: [0],
    overallTimeoutMs: 15,
    browserCloseGraceMs: 10,
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
  for (let i = 0; i < 30 && launches < 2; i += 1) await wait(10);
  expect(launches).toBe(2);
  await retireRenderer.close();

  let releaseLate!: (b: PdfBrowser) => void;
  let reentrantKill: Promise<void> | undefined;
  let lateClosed = false;
  const reentrantRenderer = new PlaywrightDocumentRenderer({
    factory: { launch: () => { reentrantKill = Promise.resolve(reentrantRenderer.kill()); return new Promise((r) => (releaseLate = r)); } },
    closeGraceMs: 20,
  });
  const pendingStart = reentrantRenderer.start();
  await wait(10);
  releaseLate(fakeBrowser({ close: async () => { lateClosed = true; } }));
  await Promise.all([pendingStart, reentrantKill]);
  expect(lateClosed).toBe(true);
});

it('retains shutdown handle for abandoned late browsers and handles undefined kill rejections', async () => {
  let releaseLate!: (b: PdfBrowser) => void;
  let kills = 0;
  const renderer = new PlaywrightDocumentRenderer({
    factory: { launch: () => new Promise((r) => (releaseLate = r)) },
    launchTimeoutMs: 15,
    closeGraceMs: 15,
  });
  await renderer.start();
  releaseLate(fakeBrowser({ kill: () => (++kills === 1 ? Promise.reject() : Promise.resolve()) }));
  await wait(40);
  expect(renderer.unconfirmedExit).not.toBeNull();
  await Promise.resolve(renderer.kill());
  expect(kills).toBe(2);
  expect(renderer.unconfirmedExit).toBeNull();

  const undefRejected = await dropRetiredBrowser(fakeBrowser({ close: async () => undefined, kill: () => Promise.reject() }), 20);
  expect(undefRejected.confirmed).toBe(true);
});
