import { expect, it } from 'vitest';

import { drainDispatchAndDocuments } from '../shutdown-drain.ts';

it('starts the document drain before the dispatch loop finishes', async () => {
  const order: string[] = [];
  let finishDispatch: () => void = () => undefined;
  const dispatch = new Promise<void>((resolve) => {
    finishDispatch = () => {
      order.push('dispatch finished');
      resolve();
    };
  });
  const draining = drainDispatchAndDocuments({
    stopDispatch: () => dispatch,
    stopDocuments: () => {
      order.push('documents stop started');
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          order.push('documents stop finished');
          resolve();
        }, 20);
      });
    },
    stopQueue: () => {
      order.push('queue stop');
      return undefined;
    },
    stopInbound: () => undefined,
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(order).toEqual(['documents stop started']);
  finishDispatch();
  await draining;
  expect(order.indexOf('documents stop started')).toBeLessThan(order.indexOf('dispatch finished'));
  expect(order.indexOf('dispatch finished')).toBeLessThan(order.indexOf('queue stop'));
  expect(order).toContain('documents stop finished');
});
