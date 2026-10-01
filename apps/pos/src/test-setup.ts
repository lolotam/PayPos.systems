import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom has no Web Locks; the POS requires them (boot-device.ts), so tests get an in-process lock with the same
// contract: one holder per name at a time, released when the callback settles.
if (globalThis.navigator.locks === undefined) {
  const held = new Map<string, Promise<unknown>>();
  const request = (name: string, run: () => Promise<unknown>) => {
    const next = (held.get(name) ?? Promise.resolve()).then(run, run);
    held.set(
      name,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  };
  Object.defineProperty(globalThis.navigator, 'locks', { value: { request }, configurable: true });
}
