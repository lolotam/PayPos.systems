import { afterAll, beforeAll, expect, it } from 'vitest';
import { AT, discountRequestFixture, must, type DiscountRequestFixture } from './session.fixture.ts';
import {
  createDecideUseCase,
  decideContext,
  fetchAudits,
  fetchOutboxEvents,
  fetchProposal,
  insertSecondEligibleMembership,
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

it('DP-14 reject with reason: REJECTED, approver_is_performer NULL, reason stored, audit without reason; second decide -> 409', async () => {
  const proposal = await requestSingleProposal(f);
  const response = await decide.execute({
    ...decideContext(f, f.editorId),
    decision: 'REJECT',
    input: {
      proposal_ids: [proposal.id],
      terms_hashes: [proposal.terms_hash],
      reason: 'الخصم كبير جداً',
    },
  });

  expect(response.proposals).toHaveLength(1);
  expect(response.proposals[0]?.status).toBe('REJECTED');
  expect(response.proposals[0]?.expires_at).toBe(proposal.expires_at);

  const row = must(await fetchProposal(f, proposal.id));
  expect(row['status']).toBe('REJECTED');
  expect(row['reject_reason']).toBe('الخصم كبير جداً');
  expect(row['approver_is_performer']).toBeNull();
  expect(row['approved_limit_source']).toBeNull();
  expect(row['approved_limit_bps']).toBeNull();
  expect(row['decided_via']).toBe('REMOTE');
  expect(row['decided_device_id']).toBeNull();
  expect(row['decided_by']).toBe(f.editorId);
  expect(row['decided_by_membership_id']).toBe(f.editorMembership);

  const audits = await fetchAudits(f, proposal.id, 'discount_proposal.rejected');
  expect(audits).toHaveLength(1);
  const auditAfter = must(audits[0])['after'] as Record<string, unknown>;
  expect(auditAfter['status']).toBe('REJECTED');
  expect(auditAfter).not.toHaveProperty('reject_reason');
  expect(auditAfter).not.toHaveProperty('approver_is_performer');

  // Second decide on already decided proposal returns 409 DISCOUNT_PROPOSAL_NOT_PENDING
  await expect(decide.execute({
    ...decideContext(f, f.editorId),
    decision: 'REJECT',
    input: {
      proposal_ids: [proposal.id],
      terms_hashes: [proposal.terms_hash],
      reason: 'محاولة ثانية',
    },
  })).rejects.toMatchObject({
    code: 'DISCOUNT_PROPOSAL_NOT_PENDING',
    details: { proposal_id: proposal.id },
  });
});

it('DP-14 and debate #4 reject without reason succeeds with 200, sets reject_reason NULL, and approver_is_performer NULL', async () => {
  const proposal = await requestSingleProposal(f);
  const response = await decide.execute({
    ...decideContext(f, f.editorId),
    decision: 'REJECT',
    input: {
      proposal_ids: [proposal.id],
      terms_hashes: [proposal.terms_hash],
    },
  });

  expect(response.proposals[0]?.status).toBe('REJECTED');
  const row = must(await fetchProposal(f, proposal.id));
  expect(row['status']).toBe('REJECTED');
  expect(row['reject_reason']).toBeNull();
  expect(row['approver_is_performer']).toBeNull();
});

it('DP-14b proposal expired at fresh instant returns 409 DISCOUNT_PROPOSAL_NOT_PENDING with nothing written', async () => {
  const proposal = await requestSingleProposal(f);
  const expiry = new Date(proposal.expires_at);
  const auditsBefore = await fetchAudits(f, proposal.id);
  const outboxBefore = await fetchOutboxEvents(f);

  try {
    f.setAt(new Date(expiry.getTime() + 1000));
    await expect(decide.execute({
      ...decideContext(f, f.editorId),
      decision: 'REJECT',
      input: {
        proposal_ids: [proposal.id],
        terms_hashes: [proposal.terms_hash],
      },
    })).rejects.toMatchObject({
      code: 'DISCOUNT_PROPOSAL_NOT_PENDING',
      details: { proposal_id: proposal.id },
    });

    const row = must(await fetchProposal(f, proposal.id));
    expect(row['status']).toBe('PENDING');
    expect(row['decided_at']).toBeNull();

    const auditsAfter = await fetchAudits(f, proposal.id);
    const outboxAfter = await fetchOutboxEvents(f);
    expect(auditsAfter.length).toBe(auditsBefore.length);
    expect(outboxAfter.length).toBe(outboxBefore.length);
  } finally {
    f.setAt(AT);
  }
});

it('debate #5 already-decided proposal with two eligible memberships and none chosen returns 409 not 422', async () => {
  const proposal = await requestSingleProposal(f);
  await decide.execute({
    ...decideContext(f, f.editorId),
    decision: 'REJECT',
    input: { proposal_ids: [proposal.id], terms_hashes: [proposal.terms_hash] },
  });

  const secondMem = await insertSecondEligibleMembership(f, f.editorId);
  try {
    await expect(decide.execute({
      ...decideContext(f, f.editorId),
      decision: 'REJECT',
      input: {
        proposal_ids: [proposal.id],
        terms_hashes: [proposal.terms_hash],
        approver_membership_id: undefined,
      },
    })).rejects.toMatchObject({
      code: 'DISCOUNT_PROPOSAL_NOT_PENDING',
      details: { proposal_id: proposal.id },
    });
  } finally {
    await f.h.owner`DELETE FROM memberships WHERE id=${secondMem}`;
  }
});

it('DP-16 batch reject with one already decided fails all-or-nothing with nothing changed', async () => {
  const proposals = await requestBatchProposals(f, [{}, {}, {}]);
  const p1 = must(proposals[0]);
  const p2 = must(proposals[1]);
  const p3 = must(proposals[2]);

  await decide.execute({
    ...decideContext(f, f.editorId),
    decision: 'REJECT',
    input: { proposal_ids: [p2.id], terms_hashes: [p2.terms_hash] },
  });

  const a1Before = await fetchAudits(f, p1.id);
  const a3Before = await fetchAudits(f, p3.id);
  const outboxBefore = await fetchOutboxEvents(f);

  await expect(decide.execute({
    ...decideContext(f, f.editorId),
    decision: 'REJECT',
    input: {
      proposal_ids: [p1.id, p2.id, p3.id],
      terms_hashes: [p1.terms_hash, p2.terms_hash, p3.terms_hash],
    },
  })).rejects.toMatchObject({
    code: 'DISCOUNT_PROPOSAL_NOT_PENDING',
    details: { proposal_id: p2.id },
  });

  const row1 = must(await fetchProposal(f, p1.id));
  const row3 = must(await fetchProposal(f, p3.id));
  expect(row1['status']).toBe('PENDING');
  expect(row3['status']).toBe('PENDING');

  const a1After = await fetchAudits(f, p1.id);
  const a3After = await fetchAudits(f, p3.id);
  const outboxAfter = await fetchOutboxEvents(f);
  expect(a1After.length).toBe(a1Before.length);
  expect(a3After.length).toBe(a3Before.length);
  expect(outboxAfter.length).toBe(outboxBefore.length);
});

it('batch reject with empty reason after trim fails with 422 DISCOUNT_REJECT_REASON_INVALID and modifies no rows', async () => {
  const proposals = await requestBatchProposals(f, [{}, {}]);
  const p1 = must(proposals[0]);
  const p2 = must(proposals[1]);
  await expect(decide.execute({
    ...decideContext(f, f.editorId),
    decision: 'REJECT',
    input: {
      proposal_ids: [p1.id, p2.id],
      terms_hashes: [p1.terms_hash, p2.terms_hash],
      reason: '   \t\n  ',
    },
  })).rejects.toMatchObject({
    code: 'DISCOUNT_REJECT_REASON_INVALID',
  });

  const row1 = must(await fetchProposal(f, p1.id));
  const row2 = must(await fetchProposal(f, p2.id));
  expect(row1['status']).toBe('PENDING');
  expect(row2['status']).toBe('PENDING');
});
