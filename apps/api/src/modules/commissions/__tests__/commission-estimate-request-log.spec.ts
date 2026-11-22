import { Writable } from 'node:stream';

import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  estimateFixture,
  estimatePath,
  type EstimateFixture,
} from './commission-estimate.fixture.ts';

let fixture: EstimateFixture;
let logs = '';

beforeAll(async () => {
  logs = '';
  fixture = await estimateFixture({
    logs: new Writable({
      write(chunk, _encoding, done) {
        logs += String(chunk);
        done();
      },
    }),
  });
});

afterAll(async () => {
  await fixture?.h.close();
});

it('binds the verified company to the request log', async () => {
  logs = '';
  const response = await fixture.h.send('GET', estimatePath(fixture.business), {
    cookie: fixture.cookie,
    company: fixture.company,
  });

  expect(response.status).toBe(200);
  const line = logs.split('\n').find((text) => text.includes('request completed')) ?? '';
  expect(line).toContain(`"company_id":"${fixture.company}"`);
});

it('never binds a company the reader does not belong to', async () => {
  const stranger = await fixture.h.signedInOperator(
    `commission-estimate-log-stranger-${Date.now()}@example.test`,
  );
  logs = '';
  const response = await fixture.h.send('GET', estimatePath(fixture.business), {
    cookie: stranger,
    company: fixture.company,
  });

  expect(response.status).toBe(403);
  const line = logs.split('\n').find((text) => text.includes('request completed')) ?? '';
  expect(line).not.toContain(`"company_id":"${fixture.company}"`);
});
