import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { discountRequestFixture, must, type DiscountRequestFixture } from './session.fixture.ts';
import { approvedProposal, draftLine, OCCURRED_AT } from './discount-consumption.helpers.ts';
import {
  createDecideUseCase,
  decideContext,
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
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'TIMEOUT'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'TIMEOUT'>((resolve) => {
    timer = setTimeout(() => resolve('TIMEOUT'), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/** اعتماد الخصم يقفل الموظفين أولاً ثم الاقتراحات لمنع تعارض 40P01 مع عمليات تحديث الموظفين. */
it('approve vs a performer-link updater: no 40P01', async () => {
  const proposal = await requestSingleProposal(f);
  const input = { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash] };

  const observer = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  const locked = barrier();
  const release = barrier();

  const blocker = f.h.owner.begin(async (write) => {
    await write`SELECT id FROM employees WHERE company_id=${f.company} AND id=${f.performerEmployeeId} FOR UPDATE`;
    locked.release();
    await release.promise;
    await write`SELECT id FROM discount_proposals WHERE company_id=${f.company} AND id=${proposal.id} FOR UPDATE`;
  });

  let deciding: Promise<unknown> | undefined;
  try {
    await locked.promise;
    const pending = decide.execute({ ...decideContext(f, f.editorId), decision: 'APPROVE', input });
    pending.catch(() => undefined);
    deciding = pending;

    await vi.waitFor(async () => {
      const waiting = await observer`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND query LIKE '%employees%'`;
      expect(waiting.length).toBeGreaterThan(0);
    }, { timeout: 5000, interval: 20 });

    release.release();
    const [decideResult, blockerResult] = await Promise.allSettled([pending, blocker]);

    for (const r of [decideResult, blockerResult]) {
      if (r.status === 'rejected') {
        const err = r.reason as { code?: string; message?: string };
        expect(err?.code).not.toBe('40P01');
        expect(err?.message).not.toContain('40P01');
      }
    }

    expect(blockerResult.status).toBe('fulfilled');
    expect(decideResult.status).toBe('fulfilled');
    if (decideResult.status === 'fulfilled') {
      expect(decideResult.value.proposals[0]?.status).toBe('APPROVED');
    }

    const row = must(await fetchProposal(f, proposal.id));
    expect(row['status']).toBe('APPROVED');
  } finally {
    release.release();
    await blocker.catch(() => undefined);
    await deciding?.catch(() => undefined);
    await observer.end();
  }
});

/** رفض الخصم لا يتطلب قفل الموظفين فيكتمل فوراً دون انتظار قفل المحدث ودون تعارض 40P01. */
it('reject vs the same updater: no 40P01 and no performer wait', async () => {
  const proposal = await requestSingleProposal(f);
  const input = { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash], reason: 'x' };

  const locked = barrier();
  const release = barrier();

  const blocker = f.h.owner.begin(async (write) => {
    await write`SELECT id FROM employees WHERE company_id=${f.company} AND id=${f.performerEmployeeId} FOR UPDATE`;
    locked.release();
    await release.promise;
    await write`SELECT id FROM discount_proposals WHERE company_id=${f.company} AND id=${proposal.id} FOR UPDATE`;
  });

  let deciding: Promise<unknown> | undefined;
  try {
    await locked.promise;
    const pending = decide.execute({ ...decideContext(f, f.editorId), decision: 'REJECT', input });
    pending.catch(() => undefined);
    deciding = pending;

    const outcome = await withTimeout(pending, 5000);
    expect(outcome).not.toBe('TIMEOUT');

    const [decideResult] = await Promise.allSettled([pending]);
    if (decideResult.status === 'rejected') {
      const err = decideResult.reason as { code?: string; message?: string };
      expect(err?.code).not.toBe('40P01');
      expect(err?.message).not.toContain('40P01');
    }
    expect(decideResult.status).toBe('fulfilled');
    if (decideResult.status === 'fulfilled') {
      expect(decideResult.value.proposals[0]?.status).toBe('REJECTED');
    }

    release.release();
    const [blockerResult] = await Promise.allSettled([blocker]);
    if (blockerResult.status === 'rejected') {
      const err = blockerResult.reason as { code?: string; message?: string };
      expect(err?.code).not.toBe('40P01');
      expect(err?.message).not.toContain('40P01');
    }
    expect(blockerResult.status).toBe('fulfilled');

    const row = must(await fetchProposal(f, proposal.id));
    expect(row['status']).toBe('REJECTED');
  } finally {
    release.release();
    await blocker.catch(() => undefined);
    await deciding?.catch(() => undefined);
  }
});

/** اعتماد دفعة بالتزامن مع إنشاء جلسة تستهلك اقتراحاً لنفس المنفذة يتبع نفس ترتيب الأقفال لتفادي 40P01. */
it('approve batch vs concurrent create consuming another proposal on the same performer: no 40P01 over 8 rounds', async () => {
  for (let round = 0; round < 8; round++) {
    const batch = await requestBatchProposals(f, [{ discount: '5.000' }, { discount: '5.000' }]);
    const p1 = must(batch[0]);
    const p2 = must(batch[1]);
    const approvedId = await approvedProposal(f, { occurred_at: OCCURRED_AT });

    const [decideResult, createResult] = await Promise.allSettled([
      decide.execute({
        ...decideContext(f, f.editorId),
        decision: 'APPROVE',
        input: {
          proposal_ids: [p1.id, p2.id],
          terms_hashes: [p1.terms_hash, p2.terms_hash],
        },
      }),
      f.create.execute({
        ...f.context(),
        input: {
          customer_id: f.customer,
          occurred_at: OCCURRED_AT,
          lines: [
            { ...draftLine(f), discount_proposal_id: approvedId },
            f.line(),
          ],
        },
      }),
    ]);

    if (decideResult.status === 'rejected') {
      const err = decideResult.reason as { code?: string; message?: string };
      expect(err?.code).not.toBe('40P01');
      expect(err?.message).not.toContain('40P01');
    }
    if (createResult.status === 'rejected') {
      const err = createResult.reason as { code?: string; message?: string };
      expect(err?.code).not.toBe('40P01');
      expect(err?.message).not.toContain('40P01');
    }

    expect(decideResult.status).toBe('fulfilled');
    if (decideResult.status === 'fulfilled') {
      expect(decideResult.value.proposals[0]?.status).toBe('APPROVED');
      expect(decideResult.value.proposals[1]?.status).toBe('APPROVED');
    }
    if (createResult.status === 'fulfilled') {
      expect(createResult.value.outcome).toBe('COMPLETE');
    }

    const row1 = must(await fetchProposal(f, p1.id));
    const row2 = must(await fetchProposal(f, p2.id));
    expect(row1['status']).toBe('APPROVED');
    expect(row2['status']).toBe('APPROVED');
  }
});
