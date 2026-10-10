import { afterAll, beforeAll, expect, it } from 'vitest';
import { CARD_CODE, clockByCardFixture, type CardFixture } from './clock-by-card.fixture.ts';
import { PHONE_X } from './passkey-device-lock.fixture.ts';
import { installationHash } from '../persistence/attendance-device-signal.ts';

let f: CardFixture;
beforeAll(async () => {
  f = await clockByCardFixture();
  await f.owner`UPDATE employee_passkeys SET installation_hash=${installationHash(f.companyId, PHONE_X)},installation_locked_at=bound_at WHERE id=${f.bindingId}`;
});
afterAll(async () => {
  await f?.close();
});

it('DL-11 reception card clocks remain independent of the personal phone lock', async () => {
  const result = await f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, f.idem());
  expect(result.operation).toBe('CLOCK_IN');
  expect(
    (await f.owner`SELECT source FROM attendance_sessions WHERE id=${result.session_id}`)[0]
      ?.source,
  ).toBe('BARCODE');
  expect(
    (await f.owner`SELECT installation_hash FROM employee_passkeys WHERE id=${f.bindingId}`)[0]
      ?.installation_hash,
  ).toBe(installationHash(f.companyId, PHONE_X));
  expect(await f.owner`SELECT id FROM attendance_device_refusals`).toHaveLength(0);
  expect(await f.owner`SELECT id FROM attendance_device_signals`).toHaveLength(0);
});
