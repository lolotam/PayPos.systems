import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { claimSlot, insertRedemption, insertRedemptionLine, redeem, redemptionFixture, type RedemptionFixture, type Sale } from '../../test/package-redemption-fixture.ts';
import { TENANT } from '../../test/tenancy-fixtures.ts';
import { withClusterRoleLock } from '../../test/role-lock.ts';

let f: RedemptionFixture, a: Sale, b: Sale, foreign: Sale;
beforeAll(async () => {
  f=await redemptionFixture();
  a=await f.asApp(async (tx) => { const s=await f.sale(tx); await redeem(tx,s); return s; });
  b=await f.asApp(async (tx) => {
    const sale=await f.sale(tx,TENANT.B);
    const s={ ...sale,redemption:a.redemption,line:a.line,session:a.session };
    await redeem(tx,s); return s;
  },TENANT.B);
  foreign=await f.asApp(async (tx) => { const s=await f.sale(tx,TENANT.B); await redeem(tx,s); return s; },TENANT.B);
});
afterAll(async () => { await f?.close(); });

it('duplicate IDs across companies stay isolated and connection reuse clears tenant context', async () => {
  for (const tenant of Object.values(TENANT)) {
    const rows=await f.asApp((tx) => tx`SELECT company_id,id FROM package_redemptions WHERE id=${a.redemption}`,tenant);
    expect(rows).toEqual([{ company_id:tenant.company,id:a.redemption }]);
  }
  expect(await f.app`SELECT id FROM package_redemptions`).toHaveLength(0);
  expect(await f.asApp((tx) => tx`SELECT id FROM package_redemptions WHERE company_id=${TENANT.B.company}`)).toHaveLength(0);
  expect(await f.asApp((tx) => tx`UPDATE package_redemptions SET reversed_at=now(),reversal_cancellation_id=${randomUUID()}
    WHERE company_id=${TENANT.B.company} RETURNING id`)).toHaveLength(0);
});

it('cross-company INSERT is refused by WITH CHECK', async () => {
  await expect(f.asApp((tx) => insertRedemption(tx,{ ...b,redemption:randomUUID(),line:randomUUID() })))
    .rejects.toMatchObject({ code:'42501' });
});

it.each(['component','slot','line'])('cross-company %s reference fails closed', async (part) => {
  await expect(f.asApp(async (tx) => {
    const s=await f.sale(tx);
    await insertRedemptionLine(tx,s);
    await insertRedemption(tx,s,part === 'component' ? { component_id:b.component,entitlement_id:b.entitlement }
      : part === 'slot' ? { slot_id:b.slot } : { line_id:foreign.line });
    await claimSlot(tx,s);
  })).rejects.toMatchObject({ code:expect.stringMatching(/^235(03|14)$/) });
});

it('same-company cross-business keys are rejected', async () => {
  const business=randomUUID();
  await f.owner`INSERT INTO businesses(id,company_id,vertical_type,name_en) VALUES(${business},${TENANT.A.company},'salon','Synthetic second business')`;
  await expect(f.asApp(async (tx) => {
    const s=await f.sale(tx); await insertRedemptionLine(tx,s);
    await insertRedemption(tx,s,{ business_id:business }); await claimSlot(tx,s);
  })).rejects.toMatchObject({ code:'23503' });
});

it('missing or RLS-hidden references cannot pass the invoker validators', async () => {
  await expect(f.asApp((tx) => tx`SELECT package_redemption_validate(${TENANT.B.company}::uuid,${b.redemption}::uuid)`))
    .rejects.toMatchObject({ code:'23514',constraint_name:'package_redemption_complete' });
  await expect(f.asApp((tx) => tx`SELECT package_redemption_validate_slot(${TENANT.B.company}::uuid,${TENANT.B.business}::uuid,${b.slot}::uuid)`))
    .rejects.toMatchObject({ code:'23514',constraint_name:'package_redemption_slot_complete' });
});

it('changing tenant context before deferred line validation fails closed', async () => {
  await expect(f.asApp(async (tx) => {
    await insertRedemptionLine(tx,{ ...a,line:randomUUID(),session:randomUUID() });
    await tx`SELECT set_config('app.company_id',${TENANT.B.company},true)`;
  })).rejects.toMatchObject({ code:'23514',constraint_name:'package_redemption_complete' });
});

it('app has no delete, truncate, identity or money UPDATE permission', async () => {
  for (const query of [
    () => f.asApp((tx) => tx`DELETE FROM package_redemptions WHERE id=${a.redemption}`),
    () => f.asApp((tx) => tx`TRUNCATE package_redemptions`),
    () => f.asApp((tx) => tx`UPDATE package_redemptions SET line_id=${randomUUID()} WHERE id=${a.redemption}`),
  ]) await expect(query()).rejects.toMatchObject({ code:'42501' });
  await expect(f.asApp((tx) => tx`UPDATE service_lines SET price=2.000,net=2.000,revision=revision+1 WHERE id=${a.line}`))
    .rejects.toMatchObject({ code:'23514' });
});

it('FORCE RLS, explicit policies, invoker functions and restricted EXECUTE match storage design', async () => {
  expect(await f.owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='package_redemptions'::regclass`)
    .toEqual([{ relrowsecurity:true,relforcerowsecurity:true }]);
  const policies=await f.owner`SELECT cmd,qual,with_check FROM pg_policies WHERE tablename='package_redemptions' ORDER BY cmd`;
  expect(policies).toHaveLength(3);
  for (const p of policies) {
    if (p.cmd !== 'INSERT') expect(p.qual).toContain('app_company_id()');
    if (p.cmd !== 'SELECT') expect(p.with_check).toContain('app_company_id()');
  }
  await withClusterRoleLock('shared',async () => {
    const rows=await f.owner`SELECT p.proname,p.prosecdef,p.proconfig,
      EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute,
      has_function_privilege('pospay_auth',p.oid,'EXECUTE') AS auth_execute,
      has_function_privilege('pospay_dispatcher',p.oid,'EXECUTE') AS dispatcher_execute,
      has_function_privilege('pospay_app',p.oid,'EXECUTE') AS app_execute
      FROM pg_proc p WHERE proname IN ('package_redemptions_write_guard','service_lines_redemption_guard',
        'package_redemption_validate_slot','package_redemption_validate','package_redemption_complete')`;
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row).toMatchObject({ prosecdef:false,proconfig:['search_path=pg_catalog, public'],
      public_execute:false,auth_execute:false,dispatcher_execute:false,app_execute:true });
  });
});
