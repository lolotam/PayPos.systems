import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Tx } from '@pospay/db';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';
import { packageLine, seedPackage } from './package-redemption.fixture.ts';

let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture(); });
afterAll(async () => { await f?.close(); });

/** كود خطأ Postgres في أي حلقة في السلسلة، مهما غلّفه المحرك. */
function refusalCode(error: unknown): string {
  const seen = new Set<unknown>();
  for (let node = error; typeof node === 'object' && node !== null && !seen.has(node); node = (node as { cause?: unknown }).cause) {
    seen.add(node);
    const code = (node as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return '';
}

/**
 * الجملة المرفوضة ترمي داخل معاملتها فتلغي المعاملة كلها.
 * القاعدة: كل جملة مرفوضة في معاملة لوحدها، لأن Postgres بيabort المعاملة بعد أول فشل
 * والجملة اللي بعدها بتاخد 25P02 (معاملة متوقفة) بدل رفضها الحقيقي.
 *
 * @param statement الجملة المرفوضة المتوقعة
 * @returns كود رفض Postgres، أو نص فارغ لو الجملة نجحت
 */
async function refuses(statement: (tx: Tx) => Promise<unknown>): Promise<string> {
  try {
    await f.db.withTenant(f.company, statement);
    return '';
  } catch (error) {
    return refusalCode(error);
  }
}

it('the runtime role may only move a slot between its state and its redemption', async () => {
  const seeded = await seedPackage(f, { sessions: 1, expiresOn: '2026-12-30' });
  expect(await refuses((tx) => tx.execute(sql`UPDATE package_session_slots SET unit_value = 2.000
    WHERE company_id = ${f.company}::uuid AND entitlement_id = ${seeded.entitlement}::uuid`))).toBe('42501');
  expect(await refuses((tx) => tx.execute(sql`UPDATE package_session_slots SET ordinal = 9
    WHERE company_id = ${f.company}::uuid AND entitlement_id = ${seeded.entitlement}::uuid`))).toBe('42501');
  expect(await refuses((tx) => tx.execute(sql`DELETE FROM package_session_slots
    WHERE company_id = ${f.company}::uuid AND entitlement_id = ${seeded.entitlement}::uuid`))).toBe('42501');
  const slots = await f.h.owner`SELECT state,unit_value,ordinal FROM package_session_slots WHERE entitlement_id=${seeded.entitlement}`;
  expect(slots[0]).toMatchObject({ state: 'FREE', unit_value: '1.000', ordinal: 1 });
});

it('the runtime role may write a redemption but never rewrite one', async () => {
  const seeded = await seedPackage(f, { sessions: 1, expiresOn: '2026-12-30' });
  await f.create.execute({ ...f.context(ids.newId()), input: f.body([packageLine(f, seeded.entitlement)]) });
  const redemption = must((await f.h.owner`SELECT id FROM package_redemptions WHERE entitlement_id=${seeded.entitlement}`)[0])['id'] as string;
  expect(await refuses((tx) => tx.execute(sql`UPDATE package_redemptions SET line_id = ${ids.newId()}::uuid
    WHERE company_id = ${f.company}::uuid AND id = ${redemption}::uuid`))).toBe('42501');
  expect(await refuses((tx) => tx.execute(sql`DELETE FROM package_redemptions
    WHERE company_id = ${f.company}::uuid AND id = ${redemption}::uuid`))).toBe('42501');
  expect(await f.h.owner`SELECT 1 FROM package_redemptions WHERE id=${redemption}`).toHaveLength(1);
});

it('another company sees neither the entitlement nor its sessions nor its redemptions', async () => {
  const seeded = await seedPackage(f, { sessions: 1, expiresOn: '2026-12-30' });
  await f.create.execute({ ...f.context(ids.newId()), input: f.body([packageLine(f, seeded.entitlement)]) });
  await f.db.withTenant(f.otherCompany, async (tx) => {
    expect(await tx.execute(sql`SELECT id FROM package_entitlements WHERE id = ${seeded.entitlement}::uuid`)).toHaveLength(0);
    expect(await tx.execute(sql`SELECT id FROM package_session_slots WHERE entitlement_id = ${seeded.entitlement}::uuid`)).toHaveLength(0);
    expect(await tx.execute(sql`SELECT id FROM package_redemptions WHERE entitlement_id = ${seeded.entitlement}::uuid`)).toHaveLength(0);
    expect(await tx.execute(sql`SELECT id FROM service_lines WHERE redemption_id IS NOT NULL`)).toHaveLength(0);
  });
});

it('a redemption cannot be written for another company', async () => {
  const seeded = await seedPackage(f, { sessions: 1, expiresOn: '2026-12-30' });
  expect(await refuses((tx) => tx.execute(sql`INSERT INTO package_redemptions(company_id,id,business_id,entitlement_id,component_id,slot_id,line_id,
    redeemed_at,recorded_by,recorded_by_membership_id)
    SELECT ${f.otherCompany}::uuid, ${ids.newId()}::uuid, ${f.business}::uuid, e.id, c.id, s.id, ${ids.newId()}::uuid,
      now(), ${f.userId}::uuid, ${f.membership}::uuid
    FROM package_entitlements e JOIN package_components c ON c.entitlement_id = e.id
    JOIN package_session_slots s ON s.component_id = c.id WHERE e.id = ${seeded.entitlement}::uuid`))).toBe('42501');
  expect(await f.h.owner`SELECT 1 FROM package_redemptions WHERE entitlement_id=${seeded.entitlement}`).toHaveLength(0);
});
