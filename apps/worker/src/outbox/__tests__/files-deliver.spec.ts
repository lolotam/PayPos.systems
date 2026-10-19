import { expect, it } from 'vitest';
import type { ClaimedEvent } from '@pospay/db';

import { deliverFilesEvent } from '../files-deliver.ts';

function event(eventType: string): ClaimedEvent {
  return { eventType } as ClaimedEvent;
}

it('registers the retention schedules after the logo consumer commits', async () => {
  const order: string[] = [];
  const outcome = await deliverFilesEvent(event('BusinessLogoChanged'), {
    register: async () => {
      order.push('register');
      return { delivered: true };
    },
    staff: (claimed, next) => next(claimed),
    core: async () => {
      order.push('core');
      return { delivered: true };
    },
  });
  expect(outcome).toEqual({ delivered: true });
  expect(order).toEqual(['core', 'register']);
});

it('does not register schedules when the logo consumer delivery fails', async () => {
  let registered = false;
  const outcome = await deliverFilesEvent(event('BusinessLogoChanged'), {
    register: async () => {
      registered = true;
      return { delivered: true };
    },
    staff: (claimed, next) => next(claimed),
    core: async () => ({ delivered: false, error: 'RETRY', retryInMs: 1000 }),
  });
  expect(outcome).toEqual({ delivered: false, error: 'RETRY', retryInMs: 1000 });
  expect(registered).toBe(false);
});

it('registers upload schedules without the database deliverer', async () => {
  let core = false;
  const outcome = await deliverFilesEvent(event('FileUploadRequested'), {
    register: async () => ({ delivered: true }),
    staff: () => {
      throw new Error('staff');
    },
    core: async () => {
      core = true;
      return { delivered: true };
    },
  });
  expect(outcome).toEqual({ delivered: true });
  expect(core).toBe(false);
});

it('leaves other events on the staff chain', async () => {
  let registered = false;
  const outcome = await deliverFilesEvent(event('CompanyCreated'), {
    register: async () => {
      registered = true;
      return { delivered: true };
    },
    staff: async (_claimed, next) => next(event('CompanyCreated')),
    core: async () => ({ delivered: true }),
  });
  expect(outcome).toEqual({ delivered: true });
  expect(registered).toBe(false);
});
