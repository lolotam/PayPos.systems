import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { AT, discountRequestFixture, ids, must, type DiscountRequestFixture } from './session.fixture.ts';
import { approvedProposal, draftLine, OCCURRED_AT } from './discount-consumption.helpers.ts';
import {
  createDecideUseCase,
  decideContext,
  fetchAudits,
  fetchOutboxEvents,
  fetchProposal,
  requestBatchProposals,
  requestSingleProposal,
} from './discount-decision.helpers.ts';
import type { DecideDiscountProposalsUseCase } from '../use-cases/decide-discount-proposals/decide-discount-proposals.usecase.ts';

let f: DiscountRequestFixture;
let decide: DecideDiscountProposalsUseCase;

beforeAll(async () => {
  f = await discountRequestFixture();
  decide = createDecideUseCase(f);
});

afterAll(async () => {
  await f?.close();
});

function barrier() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

it('DP-15 two approvers race on one row: exactly one 200 and one 409', async () => {
  const proposal = await requestSingleProposal(f);
  const input = { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash] };

  const [r1, r2] = await Promise.allSettled([
    decide.execute({ ...decideContext(f, f.editorId), decision: 'APPROVE', input }),
    decide.execute({ ...decideContext(f, f.ownerId), decision: 'APPROVE', input }),
  ]);

  const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled');
  const rejected = [r1, r2].filter((r) => r.status === 'rejected');
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);

  const error = (rejected[0] as PromiseRejectedResult).reason as { code: string };
  expect(error.code).toBe('DISCOUNT_PROPOSAL_NOT_PENDING');

  const row = must(await fetchProposal(f, proposal.id));
  expect(row['status']).toBe('APPROVED');
});

it('DP-16 batch of 3 with one over limit: whole batch refused, no row changed, no audit, no outbox', async () => {
  const batch = await requestBatchProposals(f, [
    { discount: '5.000' }, // 2000 bps
    { discount: '7.500' }, // 3000 bps (Layla limit 2000 bps)
    { discount: '5.000' }, // 2000 bps
  ]);
  const p1 = must(batch[0]);
  const p2 = must(batch[1]);
  const p3 = must(batch[2]);

  const outboxBefore = await fetchOutboxEvents(f);

  await expect(decide.execute({
    ...decideContext(f, f.editorId),
    decision: 'APPROVE',
    input: {
      proposal_ids: [p1.id, p2.id, p3.id],
      terms_hashes: [p1.terms_hash, p2.terms_hash, p3.terms_hash],
    },
  })).rejects.toMatchObject({
    code: 'DISCOUNT_APPROVER_LIMIT_TOO_LOW',
    details: { proposal_id: p2.id, limit_bps: 2000, effective_bps: 3000 },
  });

  const row1 = must(await fetchProposal(f, p1.id));
  const row2 = must(await fetchProposal(f, p2.id));
  const row3 = must(await fetchProposal(f, p3.id));
  expect(row1['status']).toBe('PENDING');
  expect(row2['status']).toBe('PENDING');
  expect(row3['status']).toBe('PENDING');

  const a1 = await fetchAudits(f, p1.id, 'discount_proposal.approved');
  const a2 = await fetchAudits(f, p2.id, 'discount_proposal.approved');
  const a3 = await fetchAudits(f, p3.id, 'discount_proposal.approved');
  expect(a1).toHaveLength(0);
  expect(a2).toHaveLength(0);
  expect(a3).toHaveLength(0);

  const events = await fetchOutboxEvents(f);
  expect(events.length).toBe(outboxBefore.length);
});

it('idempotent replay of same key and body returns stored 200; replay after permission removed -> 403; same key other body -> 422', async () => {
  const proposal = await requestSingleProposal(f);
  const key = ids.newId();
  const context = { ...decideContext(f, f.editorId), key };
  const input = { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash] };

  const first = await decide.execute({ ...context, decision: 'APPROVE', input });
  expect(first.proposals[0]?.status).toBe('APPROVED');

  const auditsBefore = await fetchAudits(f, proposal.id);
  const replay = await decide.execute({ ...context, decision: 'APPROVE', input });
  expect(replay).toEqual(first);
  const auditsAfter = await fetchAudits(f, proposal.id);
  expect(auditsAfter).toHaveLength(auditsBefore.length);

  const otherProposal = await requestSingleProposal(f);
  await expect(decide.execute({
    ...context,
    fingerprint: 'b'.repeat(64),
    decision: 'APPROVE',
    input: { proposal_ids: [otherProposal.id], terms_hashes: [otherProposal.terms_hash] },
  })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });

  await f.h.owner`UPDATE memberships SET ends_at='2026-01-02T00:00:00Z' WHERE company_id=${f.company} AND id=${f.editorMembership}`;
  try {
    await expect(decide.execute({ ...context, decision: 'APPROVE', input })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  } finally {
    await f.h.owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.editorMembership}`;
  }
});

it('debate #1 decide waits on employee row lock while injected clock passes expires_at: 409, nothing written', async () => {
  const proposal = await requestSingleProposal(f);
  const expiry = new Date(proposal.expires_at);

  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  const locked = barrier();
  const release = barrier();

  const blocker = f.h.owner.begin(async (write) => {
    await write`SELECT id FROM employees WHERE company_id=${f.company} AND id=${f.performerEmployeeId} FOR UPDATE`;
    locked.release();
    await release.promise;
  });

  let deciding: Promise<unknown> | undefined;
  try {
    await locked.promise;
    const pending = decide.execute({
      ...decideContext(f, f.editorId),
      decision: 'APPROVE',
      input: { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash] },
    });
    pending.catch(() => undefined);
    deciding = pending;

    // ننتظر حتى ينحجز قفل المنفّذين فعلاً قبل تحريك الساعة
    await vi.waitFor(async () => {
      const waiting = await observer`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query LIKE '%employees%'`;
      expect(waiting.length).toBeGreaterThan(0);
    }, { timeout: 5000, interval: 20 });

    // نتجاوز وقت الانتهاء بينما القفل ما زال محجوزاً
    f.setAt(new Date(expiry.getTime() + 1000));

    release.release();
    await blocker;

    // القرار يقرأ اللحظة بعد اكتساب القفل فيكتشف الانتهاء ويرفض بـ409
    await expect(pending).rejects.toMatchObject({
      code: 'DISCOUNT_PROPOSAL_NOT_PENDING',
      details: { proposal_id: proposal.id },
    });

    const row = must(await fetchProposal(f, proposal.id));
    expect(row['status']).toBe('PENDING');
  } finally {
    release.release();
    await blocker;
    await deciding?.catch(() => undefined);
    await observer.end();
    f.setAt(AT);
  }
});

it('race with 057-5 consumption: approved proposal consumed by line while second decide runs concurrently', async () => {
  const proposalId = await approvedProposal(f, { occurred_at: OCCURRED_AT });
  const beforeRow = must(await fetchProposal(f, proposalId));
  const termsHash = beforeRow['terms_hash'] as string;

  const [consumeResult, decideResult] = await Promise.allSettled([
    f.create.execute({
      ...f.context(),
      input: {
        customer_id: f.customer,
        occurred_at: OCCURRED_AT,
        lines: [
          { ...draftLine(f), discount_proposal_id: proposalId },
          f.line(),
        ],
      },
    }),
    decide.execute({
      ...decideContext(f, f.editorId),
      decision: 'APPROVE',
      input: { proposal_ids: [proposalId], terms_hashes: [termsHash] },
    }),
  ]);

  expect(consumeResult.status).toBe('fulfilled');
  if (consumeResult.status === 'fulfilled') {
    expect(consumeResult.value.outcome).toBe('COMPLETE');
  }
  expect(decideResult.status).toBe('rejected');
  if (decideResult.status === 'rejected') {
    expect(decideResult.reason).toMatchObject({
      code: 'DISCOUNT_PROPOSAL_NOT_PENDING',
      details: { proposal_id: proposalId },
    });
  }

  const afterRow = must(await fetchProposal(f, proposalId));
  expect(afterRow['status']).toBe('CONSUMED');
  expect(afterRow['decided_at']).toEqual(beforeRow['decided_at']);
  expect(afterRow['decided_by']).toBe(beforeRow['decided_by']);
  expect(afterRow['decided_by_membership_id']).toBe(beforeRow['decided_by_membership_id']);
  expect(afterRow['decided_via']).toBe(beforeRow['decided_via']);
  expect(afterRow['decided_device_id']).toBe(beforeRow['decided_device_id']);
});

// لازم لحظة الانتهاء تتقرأ بعد قفل إعدادات النشاط، وإلا انقبل اقتراح انتهى أثناء الانتظار.
it('debate #2 decide waits on business_settings lock while injected clock passes expires_at: 409, nothing written', async () => {
  const proposal = await requestSingleProposal(f);
  const expiry = new Date(proposal.expires_at);
  const previousSettings = await f.h.owner`SELECT limit_bps FROM business_settings
    WHERE company_id=${f.company} AND business_id=${f.business}`;
  const previousLimit = previousSettings[0]?.['limit_bps'] as number | null | undefined;
  await f.h.owner`UPDATE memberships SET limit_bps=NULL WHERE company_id=${f.company} AND id=${f.editorMembership}`;
  await f.h.owner`INSERT INTO business_settings (company_id,business_id,limit_bps)
    VALUES(${f.company},${f.business},2000)
    ON CONFLICT (company_id,business_id) DO UPDATE SET limit_bps=2000`;

  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  const locked = barrier();
  const release = barrier();
  const blocker = f.h.owner.begin(async (write) => {
    await write`SELECT business_id FROM business_settings
      WHERE company_id=${f.company} AND business_id=${f.business} FOR UPDATE`;
    locked.release();
    await release.promise;
  });

  let deciding: Promise<unknown> | undefined;
  try {
    await locked.promise;
    const pending = decide.execute({
      ...decideContext(f, f.editorId),
      decision: 'APPROVE',
      input: { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash] },
    });
    pending.catch(() => undefined);
    deciding = pending;

    await vi.waitFor(async () => {
      const waiting = await observer`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query LIKE '%business_settings%'`;
      expect(waiting.length).toBeGreaterThan(0);
    }, { timeout: 5000, interval: 20 });

    f.setAt(new Date(expiry.getTime() + 1000));
    release.release();
    await blocker;

    await expect(pending).rejects.toMatchObject({
      code: 'DISCOUNT_PROPOSAL_NOT_PENDING',
      details: { proposal_id: proposal.id },
    });
    const row = must(await fetchProposal(f, proposal.id));
    expect(row['status']).toBe('PENDING');
  } finally {
    release.release();
    await blocker;
    await deciding?.catch(() => undefined);
    await observer.end();
    f.setAt(AT);
    await f.h.owner`UPDATE memberships SET limit_bps=2000 WHERE company_id=${f.company} AND id=${f.editorMembership}`;
    if (previousLimit === undefined) {
      await f.h.owner`DELETE FROM business_settings WHERE company_id=${f.company} AND business_id=${f.business}`;
    } else {
      await f.h.owner`UPDATE business_settings SET limit_bps=${previousLimit}
        WHERE company_id=${f.company} AND business_id=${f.business}`;
    }
  }
});
