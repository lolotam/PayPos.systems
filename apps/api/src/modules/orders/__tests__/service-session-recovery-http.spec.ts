import { errorMessages } from '@pospay/i18n';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { recoveryKeyHash } from '../persistence/session-recovery.adapter.ts';
import { ids, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => {
  f = await sessionFixture();
});
afterAll(async () => {
  await f?.close();
});

it('returns 503 SESSION_RECOVERY_UNAVAILABLE with both messages when the proof insert is refused', async () => {
  const key = ids.newId();
  await f.h.owner`REVOKE INSERT ON service_session_recoveries FROM pospay_app`;
  try {
    const response = await f.h.send('POST', f.base, {
      cookie: f.cookie,
      company: f.company,
      key,
      body: { customer_id: f.customer, lines: [f.line()] },
    });
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      code: 'SESSION_RECOVERY_UNAVAILABLE',
      ...errorMessages('SESSION_RECOVERY_UNAVAILABLE'),
    });
    expect(
      await f.h
        .owner`SELECT id FROM service_session_recoveries WHERE company_id=${f.company} AND key_hash=${recoveryKeyHash(key)}`,
    ).toHaveLength(0);
  } finally {
    await f.h.owner`GRANT INSERT ON service_session_recoveries TO pospay_app`;
  }
});
