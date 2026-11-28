import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';

import { killAndWait, withLaunchCleanup } from '../playwright/factory.ts';
import { PlaywrightDocumentRenderer } from '../playwright/renderer.ts';
import { dropRetiredBrowser } from '../playwright/retire.ts';

it('returns unconfirmed within the kill grace when browser.kill never settles', async () => {
  let kills = 0;
  const startedAt = Date.now();
  const outcome = await dropRetiredBrowser(
    {
      newContext: () => new Promise(() => undefined),
      close: () => new Promise(() => undefined),
      kill: () => {
        kills += 1;
        return new Promise(() => undefined);
      },
      on: () => undefined,
    },
    20,
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  );
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
        if (launches > 1) {
          return {
            newContext: () => new Promise(() => undefined),
            close: async () => undefined,
            on: () => undefined,
          };
        }
        return {
          newContext: () => new Promise(() => undefined),
          close: () => new Promise(() => undefined),
          kill: () =>
            new Promise<void>((resolve) => {
              releaseKill = resolve;
            }),
          on: () => undefined,
        };
      },
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    backoffMs: [0],
    overallTimeoutMs: 20,
    browserCloseGraceMs: 10,
  });
  await renderer.start();
  await expect(renderer.render('<p>x</p>')).rejects.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 580));
  expect(releaseKill).toBeDefined();
  expect(launches).toBe(1);
  releaseKill?.();
  for (let i = 0; i < 20 && launches < 2; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(launches).toBe(2);
  await renderer.close();
});

it('keeps killAndWait unresolved past 500 ms until the child process emits exit', async () => {
  const proc = new EventEmitter() as EventEmitter & {
    kill: () => boolean;
    exitCode: number | null;
    signalCode: string | null;
  };
  proc.exitCode = null;
  proc.signalCode = null;
  proc.kill = () => true;

  let done = false;
  const waiting = Promise.resolve(killAndWait(proc)).then(() => {
    done = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(done).toBe(false);
  proc.exitCode = 0;
  proc.emit('exit');
  await waiting;
  expect(done).toBe(true);
});

it('does not treat a failed or rejecting kill as confirmed process exit', async () => {
  const outcome = await dropRetiredBrowser(
    {
      newContext: () => new Promise(() => undefined),
      close: () => new Promise(() => undefined),
      kill: () => Promise.reject(new Error('EPERM')),
      on: () => undefined,
    },
    10,
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  );
  expect(outcome.confirmed).toBe(false);

  const syncThrowOutcome = await dropRetiredBrowser(
    {
      newContext: () => new Promise(() => undefined),
      close: () => new Promise(() => undefined),
      kill: () => {
        throw new Error('EPERM');
      },
      on: () => undefined,
    },
    10,
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  );
  expect(syncThrowOutcome.confirmed).toBe(false);
});

it('returns from direct renderer.close() within grace on unsupported or rejecting kill while exposing unconfirmedExit', async () => {
  const escalated: Error[] = [];
  const noKillRenderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: async () => ({
        newContext: () => new Promise(() => undefined),
        close: () => new Promise(() => undefined),
        on: () => undefined,
      }),
    },
    closeGraceMs: 20,
    onUnconfirmedExit: (err) => escalated.push(err),
  });
  await noKillRenderer.start();
  const startedNoKill = Date.now();
  await noKillRenderer.close();
  expect(Date.now() - startedNoKill).toBeLessThan(1_500);
  expect(noKillRenderer.unconfirmedExit).not.toBeNull();
  expect(escalated.map((e) => e.message)).toContain('DOCUMENT_CLOSE_UNCONFIRMED');

  let releaseSlowKill: (() => void) | undefined;
  const slowKillRenderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: async () => ({
        newContext: () => new Promise(() => undefined),
        close: () => new Promise(() => undefined),
        kill: () =>
          new Promise<void>((resolve) => {
            releaseSlowKill = resolve;
          }),
        on: () => undefined,
      }),
    },
    closeGraceMs: 20,
  });
  await slowKillRenderer.start();
  const startedSlow = Date.now();
  await slowKillRenderer.close();
  expect(Date.now() - startedSlow).toBeLessThan(1_500);
  expect(slowKillRenderer.unconfirmedExit).not.toBeNull();
  releaseSlowKill?.();
  await slowKillRenderer.unconfirmedExit;
  expect(slowKillRenderer.unconfirmedExit).toBeNull();
});

it('exposes unconfirmedExit after close() for both a retiring browser and a cancelled launch', async () => {
  let releaseRetireKill: (() => void) | undefined;
  const retireRenderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: async () => ({
        newContext: () => new Promise(() => undefined),
        close: () => new Promise(() => undefined),
        kill: () => new Promise<void>((r) => (releaseRetireKill = r)),
        on: () => undefined,
      }),
    },
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

  let resolveLate!: (browser: { newContext: () => Promise<never>; close: () => Promise<void>; on: () => void }) => void;
  let releaseLateClose!: () => void;
  const cancelRenderer = new PlaywrightDocumentRenderer({
    factory: { launch: () => new Promise((resolve) => (resolveLate = resolve)) },
    closeGraceMs: 15,
  });
  const pendingStart = cancelRenderer.start();
  await cancelRenderer.close();
  await pendingStart;
  expect(cancelRenderer.unconfirmedExit).not.toBeNull();
  resolveLate({
    newContext: () => new Promise(() => undefined),
    close: () => new Promise<void>((r) => (releaseLateClose = r)),
    on: () => undefined,
  });
  await new Promise((r) => setTimeout(r, 40));
  expect(cancelRenderer.unconfirmedExit).not.toBeNull();
  releaseLateClose();
  await cancelRenderer.unconfirmedExit;
  expect(cancelRenderer.unconfirmedExit).toBeNull();
});

it('shares pending close gate across concurrent close() calls and chains kill() on an in-flight launch until late browser exits', async () => {
  let releaseCloseKill: (() => void) | undefined;
  const concurrent = new PlaywrightDocumentRenderer({
    factory: {
      launch: async () => ({
        newContext: () => new Promise(() => undefined),
        close: () => new Promise(() => undefined),
        kill: () => new Promise<void>((r) => (releaseCloseKill = r)),
        on: () => undefined,
      }),
    },
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

  let resolveLaunch!: (browser: { newContext: () => Promise<never>; close: () => Promise<void>; on: () => void }) => void;
  let releaseLateClose!: () => void;
  const killing = new PlaywrightDocumentRenderer({
    factory: { launch: () => new Promise((r) => (resolveLaunch = r)) },
    closeGraceMs: 15,
  });
  const pendingStart = killing.start();
  const killPromise = Promise.resolve(killing.kill());
  await pendingStart;
  let killResolved = false;
  void killPromise.then(() => {
    killResolved = true;
  });
  resolveLaunch({
    newContext: () => new Promise(() => undefined),
    close: () => new Promise<void>((r) => (releaseLateClose = r)),
    on: () => undefined,
  });
  await new Promise((r) => setTimeout(r, 40));
  expect(killResolved).toBe(false);
  releaseLateClose();
  await killPromise;
  expect(killResolved).toBe(true);
});

it('keeps retirement pending until descendant processes also exit after root exits', async () => {
  type FakeProc = EventEmitter & { kill: () => boolean; exitCode: number | null; signalCode: string | null; children?: FakeProc[] };
  const childProc = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill: () => true }) as FakeProc;
  const rootProc = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    children: [childProc],
    kill: () => {
      rootProc.exitCode = 0;
      rootProc.emit('exit');
      return true;
    },
  }) as FakeProc;
  let launches = 0;
  const renderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: async () => {
        launches += 1;
        if (launches > 1) return { newContext: () => new Promise(() => undefined), close: async () => undefined, on: () => undefined };
        return { newContext: () => new Promise(() => undefined), close: () => new Promise(() => undefined), kill: () => killAndWait(rootProc), on: () => undefined };
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
  expect(rootProc.exitCode).toBe(0);
  expect(launches).toBe(1);
  childProc.exitCode = 0;
  childProc.emit('exit');
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
        return { newContext: () => new Promise(() => undefined), close: async () => undefined, on: () => undefined };
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
  let releaseLaunch!: (b: { newContext: () => Promise<never>; close: () => Promise<void>; on: () => void }) => void;
  const renderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: () => {
        launches += 1;
        return new Promise((resolve) => (releaseLaunch = resolve));
      },
    },
  });
  const ac1 = new AbortController();
  const ac2 = new AbortController();
  const first = renderer.start({ signal: ac1.signal });
  const second = renderer.start({ signal: ac2.signal });
  ac1.abort();
  await first;
  expect(renderer.isAvailable()).toBe(false);
  releaseLaunch({ newContext: () => new Promise(() => undefined), close: async () => undefined, on: () => undefined });
  await second;
  expect(launches).toBe(1);
  expect(renderer.isAvailable()).toBe(true);
  await renderer.close();
});

it('retains retired browser handle after failed kill so renderer.kill() can finish retirement', async () => {
  let kills = 0;
  const renderer = new PlaywrightDocumentRenderer({
    factory: {
      launch: async () => ({
        newContext: () => new Promise(() => undefined),
        close: () => new Promise(() => undefined),
        kill: () => {
          kills += 1;
          return kills === 1 ? Promise.reject(new Error('EPERM')) : Promise.resolve();
        },
        on: () => undefined,
      }),
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    backoffMs: [0],
    overallTimeoutMs: 15,
    browserCloseGraceMs: 10,
  });
  await renderer.start();
  await expect(renderer.render('<p>x</p>')).rejects.toThrow();
  await new Promise((r) => setTimeout(r, 60));
  expect(kills).toBe(1);
  expect(renderer.unconfirmedExit).not.toBeNull();
  await Promise.resolve(renderer.kill());
  expect(kills).toBe(2);
  expect(renderer.unconfirmedExit).toBeNull();
});
