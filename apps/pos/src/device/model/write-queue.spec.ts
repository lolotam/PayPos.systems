import { describe, expect, it } from 'vitest';

import { enqueueWrite } from './write-queue';

describe('enqueueWrite', () => {
  it('runs writes strictly in sequential order', async () => {
    const log: string[] = [];

    let resolveFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    const write1 = enqueueWrite(async () => {
      log.push('first:start');
      await firstGate;
      log.push('first:finish');
      return 'one';
    });

    const write2 = enqueueWrite(async () => {
      log.push('second:start');
      log.push('second:finish');
      return 'two';
    });

    await Promise.resolve();
    expect(log).toEqual(['first:start']);

    resolveFirst();

    const [res1, res2] = await Promise.all([write1, write2]);
    expect(res1).toBe('one');
    expect(res2).toBe('two');
    expect(log).toEqual(['first:start', 'first:finish', 'second:start', 'second:finish']);
  });

  it('runs writes in order even when an earlier write rejects (clear queued after failing save)', async () => {
    const operations: string[] = [];

    let failSave: (err: Error) => void = () => undefined;
    const saveGate = new Promise<void>((_, reject) => {
      failSave = reject;
    });

    const saveJob = enqueueWrite(async () => {
      operations.push('save:start');
      await saveGate;
      operations.push('save:finish');
    });

    const startOverClearJob = enqueueWrite(async () => {
      operations.push('clear:start');
      operations.push('clear:finish');
      return 'cleared';
    });

    await Promise.resolve();
    expect(operations).toEqual(['save:start']);

    failSave(new Error('IndexedDB save failed'));

    await expect(saveJob).rejects.toThrow('IndexedDB save failed');
    const clearResult = await startOverClearJob;

    expect(clearResult).toBe('cleared');
    expect(operations).toEqual(['save:start', 'clear:start', 'clear:finish']);
  });
});
