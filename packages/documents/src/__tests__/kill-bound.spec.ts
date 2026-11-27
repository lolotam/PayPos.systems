import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';

import { killAndWait } from '../playwright/factory.ts';
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
