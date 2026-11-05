import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { cancelRedemptionLine, claimSlot, insertRedemption, insertRedemptionLine, redeem, redemptionFixture, reverse, type RedemptionFixture } from '../../test/package-redemption-fixture.ts';

let f: RedemptionFixture;
beforeAll(async () => { f=await redemptionFixture(); });
afterAll(async () => { await f?.close(); });

it.each(['same-transaction','later-transaction'])('reverses and reuses slot in %s, preserving history', async (mode) => {
  const s = await f.asApp(async (tx) => {
    const sale=await f.sale(tx); await redeem(tx,sale);
    if (mode === 'same-transaction') {
      await reverse(tx,sale);
      await redeem(tx,{ ...sale,redemption:randomUUID(),line:randomUUID(),session:randomUUID() });
    }
    return sale;
  });
  if (mode === 'later-transaction') await f.asApp(async (tx) => {
    await reverse(tx,s); await redeem(tx,{ ...s,redemption:randomUUID(),line:randomUUID(),session:randomUUID() });
  });
  const rows=await f.owner`SELECT reversed_at IS NOT NULL AS reversed FROM package_redemptions WHERE slot_id=${s.slot} ORDER BY reversed_at NULLS LAST`;
  expect(rows.map((r) => r['reversed'])).toEqual([true,false]);
});

it('reverses after a constraint flush and leaves a FREE slot', async () => {
  const s=await f.asApp(async (tx) => {
    const sale=await f.sale(tx); await redeem(tx,sale); await tx`SET CONSTRAINTS ALL IMMEDIATE`; await tx`SET CONSTRAINTS ALL DEFERRED`;
    await reverse(tx,sale); return sale;
  });
  expect(await f.owner`SELECT state,current_redemption_id FROM package_session_slots WHERE id=${s.slot}`)
    .toEqual([{ state:'FREE',current_redemption_id:null }]);
});

it('deferred cancellation FK allows reversal before the inherited 054 cancellation sequence', async () => {
  await f.asApp(async (tx) => {
    const s=await f.sale(tx), cancellation=randomUUID(); await redeem(tx,s);
    await tx`UPDATE package_redemptions SET reversed_at=now(),reversal_cancellation_id=${cancellation} WHERE id=${s.redemption}`;
    await tx`UPDATE package_session_slots SET state='FREE',current_redemption_id=NULL WHERE id=${s.slot}`;
    await cancelRedemptionLine(tx,s,cancellation); await tx`SET CONSTRAINTS ALL IMMEDIATE`;
  });
});

it.each([{ reversed_at:'2026-11-05T00:00:00Z' },{ reversal_cancellation_id:randomUUID() },
  { reversed_at:'2026-11-05T00:00:00Z',reversal_cancellation_id:randomUUID() }])('rejects initially reversed history %j', async (fields) => {
  await expect(f.asApp(async (tx) => { const s=await f.sale(tx); await insertRedemption(tx,s,fields); }))
    .rejects.toMatchObject({ code:'23514',constraint_name:'package_redemptions_write_guard' });
});

it.each(['half-time','half-cancellation','missing-cancellation','still-held','live-cancelled'])('rejects incomplete reversal %s', async (kind) => {
  await expect(f.asApp(async (tx) => {
    const s=await f.sale(tx); await redeem(tx,s);
    if (kind === 'half-time') await tx`UPDATE package_redemptions SET reversed_at=now() WHERE id=${s.redemption}`;
    else if (kind === 'half-cancellation') await tx`UPDATE package_redemptions SET reversal_cancellation_id=${randomUUID()} WHERE id=${s.redemption}`;
    else if (kind === 'missing-cancellation') await tx`UPDATE package_redemptions SET reversed_at=now(),reversal_cancellation_id=${randomUUID()} WHERE id=${s.redemption}`;
    else if (kind === 'live-cancelled') await cancelRedemptionLine(tx,s);
    else {
      await reverse(tx,s);
      if (kind === 'still-held') await claimSlot(tx,s);
    }
  })).rejects.toMatchObject({ code:expect.stringMatching(/^235(03|14)$/) });
});

it('cancelled package line cannot commit with a live redemption even after prior flush', async () => {
  await expect(f.asApp(async (tx) => {
    const s=await f.sale(tx); await redeem(tx,s); await tx`SET CONSTRAINTS ALL IMMEDIATE`; await tx`SET CONSTRAINTS ALL DEFERRED`;
    await cancelRedemptionLine(tx,s);
  })).rejects.toMatchObject({ code:'23514',constraint_name:'package_redemption_complete' });
});

it('refuses another line cancellation when both lines are correctly cancelled and both slots released', async () => {
  await expect(f.asApp(async (tx) => {
    const s=await f.sale(tx), other=await f.sale(tx); await redeem(tx,s); await redeem(tx,other);
    await tx`SET CONSTRAINTS ALL IMMEDIATE`; await tx`SET CONSTRAINTS ALL DEFERRED`;
    const wrongCancellation=await reverse(tx,s);
    await cancelRedemptionLine(tx,other);
    await tx`UPDATE package_redemptions SET reversed_at=now(),reversal_cancellation_id=${wrongCancellation} WHERE id=${other.redemption}`;
    await tx`UPDATE package_session_slots SET state='FREE',current_redemption_id=NULL WHERE id=${other.slot}`;
  })).rejects.toMatchObject({ code:'23514',constraint_name:'package_redemption_complete' });
});

it.each(['clear','change-time','change-cancellation','repeat','change-line','change-actor','change-slot'])('refuses %s after a completed reversal', async (kind) => {
  const s=await f.asApp(async (tx) => { const sale=await f.sale(tx); await redeem(tx,sale); await reverse(tx,sale); return sale; });
  const fields: Record<string,unknown> = kind === 'clear' ? { reversed_at:null,reversal_cancellation_id:null }
    : kind === 'change-time' ? { reversed_at:'2026-11-06T00:00:00Z' }
    : kind === 'change-cancellation' ? { reversal_cancellation_id:randomUUID() }
    : kind === 'change-line' ? { line_id:randomUUID() }
    : kind === 'change-actor' ? { recorded_by:randomUUID() }
    : kind === 'change-slot' ? { slot_id:randomUUID() } : { reversed_at:'2026-11-05T00:00:00Z',reversal_cancellation_id:randomUUID() };
  await expect(f.owner`UPDATE package_redemptions SET ${f.owner(fields)} WHERE id=${s.redemption}`)
    .rejects.toMatchObject({ code:'23514',constraint_name:'package_redemptions_write_guard' });
});

it('rollback and savepoint restore held balance and live history', async () => {
  const s=await f.asApp(async (tx) => { const sale=await f.sale(tx); await redeem(tx,sale); return sale; });
  await f.asApp(async (tx) => {
    await tx.savepoint(async (sp) => { await reverse(sp,s); throw new Error('synthetic rollback'); })
      .catch((error: unknown) => { expect(error).toMatchObject({ message:'synthetic rollback' }); });
    await tx`SET CONSTRAINTS ALL IMMEDIATE`;
  });
  expect(await f.owner`SELECT reversed_at FROM package_redemptions WHERE id=${s.redemption}`).toEqual([{ reversed_at:null }]);
  expect(await f.owner`SELECT current_redemption_id FROM package_session_slots WHERE id=${s.slot}`).toEqual([{ current_redemption_id:s.redemption }]);
  expect(await f.owner`SELECT id FROM service_line_cancellations WHERE line_id=${s.line}`).toHaveLength(0);
});

it('two claimants for one committed FREE slot allow exactly one commit', async () => {
  const s=await f.asApp((tx) => f.sale(tx));
  const outcomes=await Promise.allSettled([0,1].map(() => f.asApp(async (tx) => {
    const next={ ...s,redemption:randomUUID(),line:randomUUID(),session:randomUUID() };
    await insertRedemptionLine(tx,next); await insertRedemption(tx,next); await claimSlot(tx,next);
  })));
  expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const failed=outcomes.find((r) => r.status === 'rejected');
  expect(failed?.status === 'rejected' && failed.reason).toMatchObject({ code:'23505' });
  expect(await f.owner`SELECT id FROM package_redemptions WHERE slot_id=${s.slot} AND reversed_at IS NULL`).toHaveLength(1);
});

it('concurrent reversals release a held slot only once', async () => {
  const s=await f.asApp(async (tx) => { const sale=await f.sale(tx); await redeem(tx,sale); return sale; });
  const outcomes=await Promise.allSettled([0,1].map(() => f.asApp((tx) => reverse(tx,s))));
  expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const failed=outcomes.find((r) => r.status === 'rejected');
  expect(failed?.status === 'rejected' && failed.reason).toMatchObject({ code:'23514' });
  expect(await f.owner`SELECT id FROM service_line_cancellations WHERE line_id=${s.line}`).toHaveLength(1);
  expect(await f.owner`SELECT state,current_redemption_id FROM package_session_slots WHERE id=${s.slot}`).toEqual([{ state:'FREE',current_redemption_id:null }]);
});
