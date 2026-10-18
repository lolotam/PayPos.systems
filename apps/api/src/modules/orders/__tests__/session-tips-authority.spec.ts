import { afterAll, beforeAll, expect, it } from 'vitest';
import { ordersSessionTips } from '../orders.module.ts';
import { RecordSessionTipsUseCase } from '../use-cases/record-session-tips/record-session-tips.usecase.ts';
import {
  caught,
  causeChain,
  errorShape,
  holdVisit,
  ids,
  interceptDatabase,
  separateOwner,
  recordVisit,
  runTips,
  sessionRevisionCount,
  tip,
  tipFixture,
  tipInput,
  tipQuiet,
  tipRows,
  waitForAdvisory,
  type TipFixture,
} from '../../../../test/session-tips.fixture.ts';

let f: TipFixture;
beforeAll(async () => {
  f = await tipFixture();
});
afterAll(async () => {
  await f?.close();
});

it('TP-10 replays the stored body, rejects another body, and a revoked caller is not found', async () => {
  const visit = await recordVisit(f);
  const key = ids.newId();
  const fingerprint = 'a'.repeat(64);
  const input = tipInput([tip(f, 0, 'CASH', '1.500')]);
  const first = await runTips(f, visit.sessionId, input, { key, fingerprint });
  const replay = await runTips(f, visit.sessionId, input, { key, fingerprint });
  expect(JSON.stringify(replay)).toBe(JSON.stringify(first));
  expect((await tipRows(f, visit.sessionId)).revisions).toHaveLength(1);
  const reused = await caught(
    runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '2.000')]), {
      key,
      fingerprint: 'b'.repeat(64),
    }),
  );
  expect(errorShape(reused).code).toBe('IDEMPOTENCY_KEY_REUSED');
  const deny = ids.newId();
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${deny},${f.membership},'record:service-sessions:branch','DENY','BRANCH',${f.branch},'Synthetic tip deny',${f.ownerId})`;
  try {
    const revoked = await caught(runTips(f, visit.sessionId, input, { key, fingerprint }));
    expect(errorShape(revoked)).toEqual({
      code: 'SESSION_NOT_FOUND',
      message: 'SESSION_NOT_FOUND',
      details: undefined,
    });
    expect((await tipRows(f, visit.sessionId)).revisions).toHaveLength(1);
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${deny}`;
  }
});

it('D-T2 two eligible memberships require a selection and the chosen membership is stored', async () => {
  const visit = await recordVisit(f);
  const extra = ids.newId();
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    SELECT ${f.company},${extra},${f.userId},role_id,role_owner_key,'COMPANY',${f.company},limit_bps,'2026-01-01T00:00:00Z'
    FROM memberships WHERE company_id=${f.company} AND id=${f.membership}`;
  try {
    const missing = await caught(
      runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')])),
    );
    const details =
      (missing as { details?: { recorder_membership_ids?: string[] } }).details
        ?.recorder_membership_ids ?? [];
    expect(errorShape(missing).code).toBe('SESSION_RECORDER_MEMBERSHIP_REQUIRED');
    expect([...details].sort()).toEqual([f.membership, extra].sort());
    const saved = await runTips(
      f,
      visit.sessionId,
      tipInput([tip(f, 0, 'CASH', '1.000')], { recorder_membership_id: extra }),
    );
    const [row] = await f.h
      .owner`SELECT changed_by_membership_id FROM session_tip_revisions WHERE company_id=${f.company} AND session_id=${visit.sessionId}`;
    expect(saved.revision).toBe(1);
    expect(row?.['changed_by_membership_id']).toBe(extra);
  } finally {
    await f.h
      .owner`UPDATE memberships SET ends_at='2026-10-14T00:00:00Z' WHERE company_id=${f.company} AND id=${extra}`;
  }
});

it('D-T5 an unknown session and a session outside the branch, business or company are one error', async () => {
  const visit = await recordVisit(f);
  const otherBranch = ids.newId();
  await f.h
    .owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.company},${otherBranch},${f.business},'Synthetic tip branch')`;
  const input = tipInput([tip(f, 0, 'CASH', '1.000')]);
  const unknownId = ids.newId();
  const unknown = errorShape(await caught(runTips(f, unknownId, input)));
  const branch = errorShape(
    await caught(runTips(f, visit.sessionId, input, { userId: f.ownerId, branchId: otherBranch })),
  );
  const business = errorShape(
    await caught(
      runTips(f, visit.sessionId, input, {
        userId: f.ownerId,
        businessId: f.secondBusiness,
        branchId: f.secondBranch,
      }),
    ),
  );
  const company = errorShape(
    await caught(
      runTips(f, visit.sessionId, input, {
        userId: f.userId,
        companyId: f.otherCompany,
        businessId: f.foreignBusiness,
        branchId: f.foreignBranch,
      }),
    ),
  );
  expect(unknown).toEqual({
    code: 'SESSION_NOT_FOUND',
    message: 'SESSION_NOT_FOUND',
    details: undefined,
  });
  expect(branch).toEqual(unknown);
  expect(business).toEqual(unknown);
  expect(company).toEqual(unknown);
  expect(await sessionRevisionCount(f, visit.sessionId)).toBe(0);
  expect(await sessionRevisionCount(f, unknownId)).toBe(0);
});

it('a disabled orders feature is refused and a closed company is not found', async () => {
  const visit = await recordVisit(f);
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES(${f.company},'orders',false,'Synthetic feature off',${f.ownerId})`;
  try {
    expect(
      errorShape(await caught(runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]))))
        .code,
    ).toBe('FEATURE_DISABLED');
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  }
  await f.h.owner`UPDATE companies SET deleted_at=now() WHERE id=${f.company}`;
  try {
    expect(
      errorShape(await caught(runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CARD', '1.000')]))))
        .code,
    ).toBe('SESSION_NOT_FOUND');
    expect(await sessionRevisionCount(f, visit.sessionId)).toBe(0);
  } finally {
    await f.h.owner`UPDATE companies SET deleted_at=NULL WHERE id=${f.company}`;
  }
});

it('a permission revoked while the visit lock is held becomes SESSION_NOT_FOUND and writes nothing', async () => {
  const visit = await recordVisit(f);
  const key = ids.newId();
  const deny = ids.newId();
  const held = await holdVisit(f, visit.sessionId);
  const pending = runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]), { key });
  const owner = separateOwner(f);
  try {
    expect(await waitForAdvisory(f, held.pid, 1)).toBeGreaterThanOrEqual(1);
    await owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES(${f.company},${deny},${f.membership},'record:service-sessions:branch','DENY','BRANCH',${f.branch},'Synthetic tip wait deny',${f.ownerId})`;
    await held.release();
    expect(errorShape(await caught(pending))).toEqual({
      code: 'SESSION_NOT_FOUND',
      message: 'SESSION_NOT_FOUND',
      details: undefined,
    });
    expect(await tipQuiet(f, visit.sessionId, key)).toEqual({
      revisions: 0,
      entries: 0,
      audits: 0,
      events: 0,
      keys: 0,
    });
  } finally {
    await held.release();
    await pending.catch(() => undefined);
    await owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${deny}`;
    await owner.end();
  }
});

it('a failure after insertRevision rolls back and the thrown error hides the reason', async () => {
  const visit = await recordVisit(f);
  const reason = `sentinel-reason-${ids.newId()}`;
  const key = ids.newId();
  const base = ordersSessionTips(f.db);
  const tips = new RecordSessionTipsUseCase(
    {
      run: (context, work) =>
        base.run(context, (tx) => work({ ...tx, audit: () => Promise.reject(new Error(reason)) })),
    },
    ids,
    f.clock,
  );
  const error = await caught(
    tips.execute({
      ...f.context(key),
      sessionId: visit.sessionId,
      input: tipInput([tip(f, 0, 'CASH', '1.000')], { reason }),
    }),
  );
  expect((error as Error).message).toBe('SESSION_PERSISTENCE_FAILED');
  expect(causeChain(error)).not.toContain(reason);
  expect(await tipQuiet(f, visit.sessionId, key)).toEqual({
    revisions: 0,
    entries: 0,
    audits: 0,
    events: 0,
    keys: 0,
  });
});

it('a session revision unique violation maps to TIP_REVISION_CONFLICT without details', async () => {
  const visit = await recordVisit(f);
  let planted = false;
  const database = interceptDatabase(f.db, async (statement) => {
    if (planted || !/insert\s+into\s+session_tip_revisions/i.test(statement)) return;
    planted = true;
    await f.h
      .owner`INSERT INTO session_tip_revisions(company_id,id,business_id,session_id,revision,previous_revision,
      changed_by,changed_by_membership_id,changed_at,reason,event_id,write_xid)
      VALUES(${f.company},${ids.newId()},${f.business},${visit.sessionId},1,NULL,${f.userId},${f.membership},now(),NULL,${ids.newId()},'0'::xid8)`;
  });
  const tips = new RecordSessionTipsUseCase(ordersSessionTips(database), ids, f.clock);
  const key = ids.newId();
  const error = await caught(
    tips.execute({
      ...f.context(key),
      sessionId: visit.sessionId,
      input: tipInput([tip(f, 0, 'CASH', '1.000')]),
    }),
  );
  expect(errorShape(error)).toEqual({
    code: 'TIP_REVISION_CONFLICT',
    message: 'TIP_REVISION_CONFLICT',
    details: undefined,
  });
  expect(await tipQuiet(f, visit.sessionId, key)).toMatchObject({
    entries: 0,
    audits: 0,
    events: 0,
    keys: 0,
  });
  expect(await sessionRevisionCount(f, visit.sessionId)).toBe(1);
});
