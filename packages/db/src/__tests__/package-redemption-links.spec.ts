import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ORDER_IDS } from '../../test/orders-fixture.ts';
import { claimSlot, insertRedemption, insertRedemptionLine, redeem, redemptionFixture, type RedemptionFixture } from '../../test/package-redemption-fixture.ts';
import { TENANT } from '../../test/tenancy-fixtures.ts';

let f: RedemptionFixture;
beforeAll(async () => { f = await redemptionFixture(); });
afterAll(async () => { await f?.close(); });

it.each(['0.000','0.001','1.001','99999999999.999'])('commits exact slot value %s and reciprocal links', async (value) => {
  const s = await f.asApp(async (tx) => { const sale = await f.sale(tx,TENANT.A,value); await redeem(tx,sale); return sale; });
  const [row] = await f.owner`SELECT l.redemption_id,r.line_id,s.current_redemption_id,l.price::text
    FROM service_lines l JOIN package_redemptions r ON r.company_id=l.company_id AND r.id=l.redemption_id
    JOIN package_session_slots s ON s.company_id=r.company_id AND s.id=r.slot_id WHERE l.id=${s.line}`;
  expect(row).toEqual({ redemption_id:s.redemption,line_id:s.line,current_redemption_id:s.redemption,price:value });
});

it.each(['redemption-first','slot-first'])('deferred circular links allow %s ordering', async (order) => {
  await f.asApp(async (tx) => {
    const s = await f.sale(tx);
    if (order === 'slot-first') await claimSlot(tx,s);
    await insertRedemption(tx,s); await insertRedemptionLine(tx,s);
    if (order === 'redemption-first') await claimSlot(tx,s);
    await tx`SET CONSTRAINTS ALL IMMEDIATE`;
  });
});

it.each(['missing-line','paid-line','crossed-line','missing-redemption','free-slot','other-slot'])('refuses %s at commit', async (kind) => {
  await expect(f.asApp(async (tx) => {
    const s = await f.sale(tx);
    if (kind !== 'missing-line') await insertRedemptionLine(tx,s,kind === 'paid-line' ? { redemption_id:null } : kind === 'crossed-line' ? { redemption_id:randomUUID() } : {});
    if (kind !== 'missing-redemption') await insertRedemption(tx,s,kind === 'other-slot' ? { slot_id:randomUUID() } : {});
    if (kind !== 'free-slot') await claimSlot(tx,s);
  })).rejects.toMatchObject({ code: expect.stringMatching(/^235(03|14)$/) });
});

it.each([
  { list_price:'1.001' }, { price:'1.001',net:'1.001' }, { discount:'0.001',net:'0.999' },
  { net:'0.999' }, { effective_discount_bps:1 }, { list_price:'NaN' }, { price:'-0.001',net:'-0.001' },
])('refuses individual package money mismatch %j', async (fields) => {
  await expect(f.asApp(async (tx) => {
    const s = await f.sale(tx); await insertRedemptionLine(tx,s,fields); await insertRedemption(tx,s); await claimSlot(tx,s);
  })).rejects.toMatchObject({ code:'23514' });
});

it('refuses another customer in the same business, but allows a different serving branch', async () => {
  const customer = randomUUID(), branch = randomUUID();
  await f.owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES(${TENANT.A.company},${customer},'Synthetic other','+999999998124','en',now(),now())`;
  await f.owner`INSERT INTO branches(id,company_id,business_id,name_en) VALUES(${branch},${TENANT.A.company},${TENANT.A.business},'Synthetic second')`;
  await expect(f.asApp(async (tx) => {
    const s = await f.sale(tx); await insertRedemptionLine(tx,s,{}, { customer_id:customer });
    await insertRedemption(tx,s); await claimSlot(tx,s);
  })).rejects.toMatchObject({ code: expect.stringMatching(/^235(14|03)$/) });
  await f.asApp(async (tx) => {
    const s = await f.sale(tx); await insertRedemptionLine(tx,s,{}, { branch_id:branch });
    await insertRedemption(tx,s); await claimSlot(tx,s);
  });
});

it('rejects a mismatched service and a component from another entitlement', async () => {
  const service = randomUUID();
  await f.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${TENANT.A.company},${service},${TENANT.A.business},'Synthetic other',1,'ZERO')`;
  for (const kind of ['service','component']) await expect(f.asApp(async (tx) => {
    const s = await f.sale(tx), other = await f.sale(tx);
    await insertRedemptionLine(tx,s,kind === 'service' ? { service_id:service } : {});
    await insertRedemption(tx,s,kind === 'component' ? { component_id:other.component } : {}); await claimSlot(tx,s);
  })).rejects.toMatchObject({ code: expect.stringMatching(/^235(03|14)$/) });
});

it.each(['marker-add','marker-clear','marker-replace','list_price','price','discount','net','effective_discount_bps'])('immediate guard freezes %s even with owner column access', async (kind) => {
  const s = await f.asApp(async (tx) => { const sale = await f.sale(tx); await redeem(tx,sale); return sale; });
  const field = kind.startsWith('marker-') ? 'redemption_id' : kind;
  const value = kind === 'marker-clear' ? null : kind.startsWith('marker-') ? randomUUID() : 2;
  const line = kind === 'marker-add' ? ORDER_IDS.line : s.line;
  await expect(f.owner`UPDATE service_lines SET ${f.owner({ [field]:value })} WHERE company_id=${TENANT.A.company} AND id=${line}`)
    .rejects.toMatchObject({ code:'23514',constraint_name:'service_lines_redemption_guard' });
  await expect(f.asApp((tx) => tx`UPDATE service_lines SET redemption_id=NULL WHERE id=${s.line}`))
    .rejects.toMatchObject({ code:'42501' });
});

it.each(['release','repoint-missing','repoint-other-slot'])('rechecks %s after IMMEDIATE then DEFERRED', async (kind) => {
  await expect(f.asApp(async (tx) => {
    const s = await f.sale(tx); await redeem(tx,s);
    const other = await f.sale(tx); await redeem(tx,other);
    await tx`SET CONSTRAINTS ALL IMMEDIATE`; await tx`SET CONSTRAINTS ALL DEFERRED`;
    if (kind === 'release') await tx`UPDATE package_session_slots SET state='FREE',current_redemption_id=NULL WHERE id=${s.slot}`;
    else await tx`UPDATE package_session_slots SET current_redemption_id=${kind === 'repoint-missing' ? randomUUID() : other.redemption} WHERE id=${s.slot}`;
  })).rejects.toMatchObject({ code: expect.stringMatching(/^235(03|14)$/) });
});

it('fails an early constraint flush on incomplete links and rolls back all rows', async () => {
  let line = '';
  await expect(f.asApp(async (tx) => {
    const s = await f.sale(tx); line=s.line; await insertRedemptionLine(tx,s); await tx`SET CONSTRAINTS ALL IMMEDIATE`;
  })).rejects.toMatchObject({ code: expect.stringMatching(/^235(03|14)$/) });
  expect(await f.owner`SELECT id FROM service_lines WHERE id=${line}`).toHaveLength(0);
});

it('refuses duplicate line ownership and two live redemptions of one slot', async () => {
  for (const kind of ['line','slot']) await expect(f.asApp(async (tx) => {
    const s = await f.sale(tx); await redeem(tx,s);
    const next = { ...s,redemption:randomUUID(),line:kind === 'line' ? s.line : randomUUID(),session:randomUUID() };
    if (kind === 'slot') await insertRedemptionLine(tx,next);
    await insertRedemption(tx,next);
  })).rejects.toMatchObject({ code:'23505' });
});

it('a second line cannot borrow an otherwise valid redemption after an earlier flush', async () => {
  await expect(f.asApp(async (tx) => {
    const s=await f.sale(tx); await redeem(tx,s); await tx`SET CONSTRAINTS ALL IMMEDIATE`; await tx`SET CONSTRAINTS ALL DEFERRED`;
    await insertRedemptionLine(tx,{ ...s,line:randomUUID(),session:randomUUID() });
  })).rejects.toMatchObject({ code:'23514',constraint_name:'package_redemption_complete' });
});
