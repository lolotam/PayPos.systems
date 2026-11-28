import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import type { PdfBrowser } from '../playwright/browser.ts';
import { killAndWait, withLaunchCleanup } from '../playwright/factory.ts';
import {
  beginLaunchProcessCapture,
  directLinuxChildren,
  isLinuxStatZombie,
  isPidAlive,
  LAUNCH_MARKER_ENV,
  recordLaunchedProcess,
  takeLaunchedProcess,
} from '../playwright/process-tree.ts';
import { PlaywrightDocumentRenderer } from '../playwright/renderer.ts';
import { dropRetiredBrowser } from '../playwright/retire.ts';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function fakeBrowser(overrides: Partial<PdfBrowser> = {}): PdfBrowser {
  return { newContext: () => new Promise(() => undefined), close: () => new Promise(() => undefined), on: () => undefined, ...overrides };
}

it('returns unconfirmed within the kill grace when browser.kill never settles', async () => {
  let kills = 0;
  const startedAt = Date.now();
  const outcome = await dropRetiredBrowser(fakeBrowser({ kill: () => { kills += 1; return new Promise(() => undefined); } }), 20, wait);
  expect(kills).toBe(1);
  expect(outcome.confirmed).toBe(false);
  expect(Date.now() - startedAt).toBeLessThan(1_500);
});

it('waits past the 500 ms kill grace until process exit is confirmed before relaunching', async () => {
  let launches = 0;
  let releaseKill: (() => void) | undefined;
  const renderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: async () => {
        launches += 1;
        return launches > 1
          ? fakeBrowser({ close: async () => undefined })
          : fakeBrowser({ kill: () => new Promise<void>((resolve) => (releaseKill = resolve)) });
      },
    },
    sleep: wait,
    backoffMs: [0],
    overallTimeoutMs: 20,
    browserCloseGraceMs: 10,
  });
  await renderer.start();
  await expect(renderer.render('<p>x</p>')).rejects.toThrow();
  await wait(580);
  expect(releaseKill).toBeDefined();
  expect(launches).toBe(1);
  releaseKill?.();
  for (let i = 0; i < 20 && launches < 2; i += 1) await wait(10);
  expect(launches).toBe(2);
  await renderer.close();
});

it('keeps killAndWait unresolved past 500 ms until the child process emits exit', async () => {
  const proc = new EventEmitter() as EventEmitter & { kill: () => boolean; exitCode: number | null; signalCode: string | null };
  proc.exitCode = null;
  proc.signalCode = null;
  proc.kill = () => true;
  let done = false;
  const waiting = Promise.resolve(killAndWait(proc)).then(() => { done = true; });
  await wait(600);
  expect(done).toBe(false);
  proc.exitCode = 0;
  proc.emit('exit');
  await waiting;
  expect(done).toBe(true);
});

it('does not treat a failed or rejecting kill as confirmed process exit', async () => {
  const rejected = await dropRetiredBrowser(fakeBrowser({ kill: () => Promise.reject(new Error('EPERM')) }), 10, wait);
  expect(rejected.confirmed).toBe(false);
  const thrown = await dropRetiredBrowser(fakeBrowser({ kill: () => { throw new Error('EPERM'); } }), 10, wait);
  expect(thrown.confirmed).toBe(false);
});

it('returns from direct renderer.close() within grace on unsupported or rejecting kill while exposing unconfirmedExit', async () => {
  const escalated: Error[] = [];
  const noKill = new PlaywrightDocumentRenderer({ factory: { launch: async () => fakeBrowser() }, closeGraceMs: 20, onUnconfirmedExit: (e) => escalated.push(e) });
  await noKill.start();
  const t0 = Date.now();
  await noKill.close();
  expect(Date.now() - t0).toBeLessThan(1_500);
  expect(noKill.unconfirmedExit).not.toBeNull();
  expect(escalated.map((e) => e.message)).toContain('DOCUMENT_CLOSE_UNCONFIRMED');

  let releaseSlowKill: (() => void) | undefined;
  const slow = new PlaywrightDocumentRenderer({ factory: { launch: async () => fakeBrowser({ kill: () => new Promise<void>((r) => (releaseSlowKill = r)) }) }, closeGraceMs: 20 });
  await slow.start();
  const t1 = Date.now();
  await slow.close();
  expect(Date.now() - t1).toBeLessThan(1_500);
  expect(slow.unconfirmedExit).not.toBeNull();
  releaseSlowKill?.();
  await slow.unconfirmedExit;
  expect(slow.unconfirmedExit).toBeNull();
});

it('exposes unconfirmedExit after close() for both a retiring browser and a cancelled launch', async () => {
  let releaseRetireKill: (() => void) | undefined;
  const retireRenderer = new PlaywrightDocumentRenderer({
    factory: { launch: async () => fakeBrowser({ kill: () => new Promise<void>((r) => (releaseRetireKill = r)) }) },
    overallTimeoutMs: 15,
    browserCloseGraceMs: 10,
    closeGraceMs: 10,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  await retireRenderer.start();
  await expect(retireRenderer.render('<p>x</p>')).rejects.toThrow();
  await new Promise((r) => setTimeout(r, 30));
  await retireRenderer.close();
  expect(retireRenderer.unconfirmedExit).not.toBeNull();
  releaseRetireKill?.();
  await retireRenderer.unconfirmedExit;
  expect(retireRenderer.unconfirmedExit).toBeNull();

  let resolveLate!: (browser: PdfBrowser) => void;
  let releaseLateClose!: () => void;
  const cancelRenderer = new PlaywrightDocumentRenderer({
    factory: { launch: () => new Promise((resolve) => (resolveLate = resolve)) },
    closeGraceMs: 15,
  });
  const pendingStart = cancelRenderer.start();
  await cancelRenderer.close();
  await pendingStart;
  expect(cancelRenderer.unconfirmedExit).not.toBeNull();
  resolveLate(fakeBrowser({ close: () => new Promise<void>((r) => (releaseLateClose = r)) }));
  await new Promise((r) => setTimeout(r, 40));
  expect(cancelRenderer.unconfirmedExit).not.toBeNull();
  releaseLateClose();
  await cancelRenderer.unconfirmedExit;
  expect(cancelRenderer.unconfirmedExit).toBeNull();
});

it('shares pending close gate across concurrent close() calls and chains kill() on an in-flight launch until late browser exits', async () => {
  let releaseCloseKill: (() => void) | undefined;
  const concurrent = new PlaywrightDocumentRenderer({
    factory: { launch: async () => fakeBrowser({ kill: () => new Promise<void>((r) => (releaseCloseKill = r)) }) },
    closeGraceMs: 15,
  });
  await concurrent.start();
  const firstClose = concurrent.close();
  const secondClose = concurrent.close();
  expect(concurrent.unconfirmedExit).not.toBeNull();
  await Promise.all([firstClose, secondClose]);
  expect(concurrent.unconfirmedExit).not.toBeNull();
  releaseCloseKill?.();
  await concurrent.unconfirmedExit;
  expect(concurrent.unconfirmedExit).toBeNull();

  let resolveLaunch!: (browser: PdfBrowser) => void;
  let releaseLateClose!: () => void;
  const killing = new PlaywrightDocumentRenderer({
    factory: { launch: () => new Promise((r) => (resolveLaunch = r)) },
    closeGraceMs: 15,
  });
  const pendingStart = killing.start();
  const killPromise = Promise.resolve(killing.kill());
  await pendingStart;
  let killResolved = false;
  void killPromise.then(() => { killResolved = true; });
  resolveLaunch(fakeBrowser({ close: () => new Promise<void>((r) => (releaseLateClose = r)) }));
  await new Promise((r) => setTimeout(r, 40));
  expect(killResolved).toBe(false);
  releaseLateClose();
  await killPromise;
  expect(killResolved).toBe(true);
});

function createFakeProcessTree() {
  type FakeProc = EventEmitter & { kill: () => boolean; exitCode: number | null; signalCode: string | null; children?: FakeProc[] };
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill: () => true }) as FakeProc;
  const root = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    children: [child],
    kill: () => {
      root.exitCode = 0;
      root.emit('exit');
      return true;
    },
  }) as FakeProc;
  return { root, child };
}

it('keeps retirement pending until descendant processes also exit after root exits', async () => {
  const { root, child } = createFakeProcessTree();
  let launches = 0;
  const renderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: async () => {
        launches += 1;
        return launches > 1 ? fakeBrowser({ close: async () => undefined }) : fakeBrowser({ kill: () => killAndWait(root) });
      },
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    backoffMs: [0],
    overallTimeoutMs: 15,
    browserCloseGraceMs: 10,
  });
  await renderer.start();
  await expect(renderer.render('<p>x</p>')).rejects.toThrow();
  await new Promise((r) => setTimeout(r, 80));
  expect(root.exitCode).toBe(0);
  expect(launches).toBe(1);
  child.exitCode = 0;
  child.emit('exit');
  for (let i = 0; i < 30 && launches < 2; i += 1) await new Promise((r) => setTimeout(r, 10));
  expect(launches).toBe(2);
  await renderer.close();
});

it('holds launch gate closed while post-spawn launch cleanup is still running', async () => {
  let launches = 0;
  let releaseCleanup!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  const renderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: async () => {
        launches += 1;
        if (launches === 1) throw withLaunchCleanup(new Error('launch timeout'), cleanup);
        return fakeBrowser({ close: async () => undefined });
      },
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    backoffMs: [0],
  });
  await renderer.start();
  await new Promise((r) => setTimeout(r, 50));
  expect(launches).toBe(1);
  expect(renderer.unconfirmedExit).not.toBeNull();
  releaseCleanup();
  for (let i = 0; i < 30 && !renderer.isAvailable(); i += 1) await new Promise((r) => setTimeout(r, 10));
  expect(launches).toBe(2);
  await renderer.close();
});

it('keeps shared launch alive for a second caller when first caller aborts its own signal', async () => {
  let launches = 0;
  let releaseLaunch!: (b: PdfBrowser) => void;
  const renderer = new PlaywrightDocumentRenderer({
    factory: { launch: () => { launches += 1; return new Promise((resolve) => (releaseLaunch = resolve)); } },
  });
  const ac1 = new AbortController();
  const ac2 = new AbortController();
  const first = renderer.start({ signal: ac1.signal });
  const second = renderer.start({ signal: ac2.signal });
  ac1.abort();
  await first;
  expect(renderer.isAvailable()).toBe(false);
  releaseLaunch(fakeBrowser({ close: async () => undefined }));
  await second;
  expect(launches).toBe(1);
  expect(renderer.isAvailable()).toBe(true);
  await renderer.close();
});

it('retains retired browser handle after failed kill so renderer.kill() can finish retirement', async () => {
  let kills = 0;
  const renderer = new PlaywrightDocumentRenderer({
    factory: { launch: async () => fakeBrowser({ kill: () => (++kills === 1 ? Promise.reject(new Error('EPERM')) : Promise.resolve()) }) },
    sleep: wait,
    backoffMs: [0],
    overallTimeoutMs: 15,
    browserCloseGraceMs: 10,
  });
  await renderer.start();
  await expect(renderer.render('<p>x</p>')).rejects.toThrow();
  await wait(60);
  expect(kills).toBe(1);
  expect(renderer.unconfirmedExit).not.toBeNull();
  await Promise.resolve(renderer.kill());
  expect(kills).toBe(2);
  expect(renderer.unconfirmedExit).toBeNull();
});

it('treats procfs zombies as exited, ignores disappearing threads, and captures launched process handles', () => {
  expect(isLinuxStatZombie('12 (chr) b) Z 1 12')).toBe(true);
  expect(isLinuxStatZombie('12 (chrome) S 1 12')).toBe(false);
  const procDir = mkdtempSync(join(tmpdir(), 'pospay-proc-'));
  const parentPid = process.pid === 100 ? 104 : 100;
  const writeProc = (id: string, files: Record<string, string>) => {
    mkdirSync(join(procDir, id), { recursive: true });
    for (const [name, body] of Object.entries(files)) writeFileSync(join(procDir, id, name), body);
  };
  try {
    mkdirSync(join(procDir, String(parentPid), 'task', '999'), { recursive: true });
    writeProc(`${parentPid}/task/${parentPid}`, { children: '101\n' });
    writeProc(`${parentPid}/task/102`, { children: '103\n' });
    expect(directLinuxChildren(parentPid, procDir)).toEqual([101, 103]);
    expect(isPidAlive(process.pid, procDir)).toBe(true);
  } finally {
    rmSync(procDir, { recursive: true, force: true });
  }
  const { root } = createFakeProcessTree();
  beginLaunchProcessCapture('m-1');
  recordLaunchedProcess({ [LAUNCH_MARKER_ENV]: 'other' }, createFakeProcessTree().root);
  recordLaunchedProcess({ [LAUNCH_MARKER_ENV]: 'm-1' }, root);
  expect(takeLaunchedProcess('m-1')).toBe(root);
  expect(takeLaunchedProcess('m-1')).toBeNull();
});

it('holds launch gate when late post-timeout factory rejection carries withLaunchCleanup', async () => {
  let launches = 0;
  let rejectFirst!: (err: Error) => void;
  let releaseCleanup!: () => void;
  const cleanup = new Promise<void>((resolve) => (releaseCleanup = resolve));
  const renderer = new PlaywrightDocumentRenderer({
    factory: { launch: () => { launches += 1; return launches === 1 ? new Promise((_, rej) => (rejectFirst = rej)) : Promise.resolve(fakeBrowser({ close: async () => undefined })); } },
    launchTimeoutMs: 15,
    sleep: wait,
    backoffMs: [0],
  });
  await renderer.start();
  rejectFirst(withLaunchCleanup(new Error('late'), cleanup));
  await wait(40);
  expect(launches).toBe(1);
  expect(renderer.unconfirmedExit).not.toBeNull();
  releaseCleanup();
  for (let i = 0; i < 30 && !renderer.isAvailable(); i += 1) await wait(10);
  expect(launches).toBe(2);
  await renderer.close();
});

it('keeps retirement gated on descendant exit even if browser.close() resolves first', async () => {
  const { root, child } = createFakeProcessTree();
  let launches = 0;
  let releaseClose!: () => void;
  const renderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: async () => {
        launches += 1;
        return launches > 1
          ? fakeBrowser({ close: async () => undefined })
          : fakeBrowser({ close: () => new Promise<void>((r) => (releaseClose = r)), kill: () => killAndWait(root) });
      },
    },
    sleep: wait,
    backoffMs: [0],
    overallTimeoutMs: 15,
    browserCloseGraceMs: 10,
  });
  await renderer.start();
  await expect(renderer.render('<p>x</p>')).rejects.toThrow();
  await wait(40);
  expect(root.exitCode).toBe(0);
  releaseClose();
  await wait(40);
  expect(launches).toBe(1);
  child.exitCode = 0;
  child.emit('exit');
  for (let i = 0; i < 30 && launches < 2; i += 1) await wait(10);
  expect(launches).toBe(2);
  await renderer.close();
});

it('keeps close() gated on active external kill even if browser.close() resolves within grace', async () => {
  const { root, child } = createFakeProcessTree();
  let releaseClose!: () => void;
  const renderer = new PlaywrightDocumentRenderer({
    factory: { launch: async () => fakeBrowser({ close: () => new Promise<void>((r) => (releaseClose = r)), kill: () => killAndWait(root) }) },
    closeGraceMs: 120,
  });
  await renderer.start();
  const closing = renderer.close();
  let closeDone = false;
  void closing.then(() => { closeDone = true; });
  const killing = Promise.resolve(renderer.kill());
  await wait(10);
  expect(root.exitCode).toBe(0);
  releaseClose();
  await wait(20);
  expect(closeDone).toBe(false);
  expect(renderer.unconfirmedExit).not.toBeNull();
  child.exitCode = 0;
  child.emit('exit');
  await Promise.all([closing, killing]);
  expect(renderer.unconfirmedExit).toBeNull();
});

it('keeps root-rejected process tree waiting for descendants and keeps close gated during kill retries', async () => {
  const { root, child } = createFakeProcessTree();
  root.kill = () => { throw new Error('EPERM'); };
  let treeDone = false;
  const treeKill = Promise.resolve(killAndWait(root)).catch(() => { treeDone = true; });
  await wait(20);
  expect(treeDone).toBe(false);
  child.exitCode = 0;
  child.emit('exit');
  await treeKill;
  expect(treeDone).toBe(true);

  let kills = 0;
  let releaseClose!: () => void;
  let releaseRetry!: () => void;
  const renderer = new PlaywrightDocumentRenderer({
    factory: { launch: async () => fakeBrowser({ close: () => new Promise<void>((r) => (releaseClose = r)), kill: () => (++kills === 1 ? Promise.reject(new Error('EPERM')) : new Promise<void>((r) => (releaseRetry = r))) }) },
    closeGraceMs: 10,
  });
  await renderer.start();
  await renderer.close();
  expect(renderer.unconfirmedExit).not.toBeNull();
  const retry = Promise.resolve(renderer.kill());
  releaseClose();
  await wait(20);
  expect(renderer.unconfirmedExit).not.toBeNull();
  releaseRetry();
  await retry;
  expect(renderer.unconfirmedExit).toBeNull();
});
