import { afterAll, beforeAll, expect, it } from 'vitest';
import { ids, must, editFixture, type EditFixture } from './session.fixture.ts';
import { editBody, quietCounts, recorded, runEdit } from './line-edit.helpers.ts';
import { employeePerson, replacePerformers, type PerformerChangeHost } from './line-identity.helpers.ts';

let f: EditFixture;
beforeAll(async () => { f = await editFixture(); });
afterAll(async () => { await f?.close(); });

it('FR-017 a performer removed from the line cannot edit its price and nothing is written', async () => {
  const visit = await editorVisit(f);
  await removeEditor(f, visit.sessionId, visit.lineId);
  const key = ids.newId();
  await expect(runEdit(f, visit.sessionId, visit.lineId, editBody({ expected_revision: 2 }), { key })).rejects.toThrow(
    'SESSION_PERFORMER_SELF_FORBIDDEN',
  );
  expect(await quietCounts(f, visit.sessionId, visit.lineId, key)).toEqual({ edits: 0, audits: 0, events: 0, keys: 0 });
});

it('FR-017 the removed identity still forbids the editor after the employee is relinked and re-added', async () => {
  const visit = await editorVisit(f);
  await removeEditor(f, visit.sessionId, visit.lineId);
  await f.h.owner`UPDATE employees SET user_id=${f.userId} WHERE company_id=${f.company} AND id=${f.editorEmployee}`;
  try {
    const readded = await employeePerson(changeHost(f), f.editorEmployee);
    await replacePerformers(changeHost(f), visit.sessionId, visit.lineId, 2, [readded]);
    const key = ids.newId();
    await expect(runEdit(f, visit.sessionId, visit.lineId, editBody({ expected_revision: 3 }), { key })).rejects.toThrow(
      'SESSION_PERFORMER_SELF_FORBIDDEN',
    );
    expect(await quietCounts(f, visit.sessionId, visit.lineId, key)).toEqual({ edits: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    await f.h.owner`UPDATE employees SET user_id=${f.editorId} WHERE company_id=${f.company} AND id=${f.editorEmployee}`;
  }
});

it('FR-017 another manager still edits the line after the performer was removed', async () => {
  const visit = await editorVisit(f);
  await removeEditor(f, visit.sessionId, visit.lineId);
  const saved = await runEdit(f, visit.sessionId, visit.lineId, editBody({ expected_revision: 2 }), { userId: f.ownerId });
  expect(saved).toMatchObject({ line: { revision: 3 } });
});

it('FR-017 a removed performer who was later soft-deleted still blocks her linked user and not another manager', async () => {
  const visit = await editorVisit(f);
  await removeEditor(f, visit.sessionId, visit.lineId);
  await f.h.owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${f.editorEmployee}`;
  try {
    const key = ids.newId();
    await expect(runEdit(f, visit.sessionId, visit.lineId, editBody({ expected_revision: 2 }), { key })).rejects.toThrow(
      'SESSION_PERFORMER_SELF_FORBIDDEN',
    );
    expect(await quietCounts(f, visit.sessionId, visit.lineId, key)).toEqual({ edits: 0, audits: 0, events: 0, keys: 0 });
    const saved = await runEdit(f, visit.sessionId, visit.lineId, editBody({ expected_revision: 2 }), { userId: f.ownerId });
    expect(saved).toMatchObject({ line: { revision: 3 } });
  } finally {
    await f.h.owner`UPDATE employees SET deleted_at=NULL WHERE company_id=${f.company} AND id=${f.editorEmployee}`;
  }
});

it('FR-017 a removed performer with no linked user at recording blocks the user linked to her later', async () => {
  const visit = await recorded(f, '25.000', '0.000', [{ employee_id: must(f.employees[0]) }]);
  const removed = must(f.employees[0]);
  const replacement = await employeePerson(changeHost(f), must(f.employees[1]));
  await replacePerformers(changeHost(f), visit.sessionId, visit.lineId, 1, [replacement]);
  await f.h.owner`UPDATE employees SET user_id=${f.editorId} WHERE company_id=${f.company} AND id=${removed}`;
  try {
    const key = ids.newId();
    await expect(runEdit(f, visit.sessionId, visit.lineId, editBody({ expected_revision: 2 }), { key })).rejects.toThrow(
      'SESSION_PERFORMER_SELF_FORBIDDEN',
    );
    expect(await quietCounts(f, visit.sessionId, visit.lineId, key)).toEqual({ edits: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    await f.h.owner`UPDATE employees SET user_id=NULL WHERE company_id=${f.company} AND id=${removed}`;
  }
});

async function editorVisit(fixture: EditFixture) {
  const visit = await recorded(fixture, '25.000', '0.000', [{ employee_id: fixture.editorEmployee }]);
  return { sessionId: visit.sessionId, lineId: visit.lineId };
}

async function removeEditor(fixture: EditFixture, sessionId: string, lineId: string) {
  const next = await employeePerson(changeHost(fixture), must(fixture.employees[0]));
  await replacePerformers(changeHost(fixture), sessionId, lineId, 1, [next]);
}

function changeHost(fixture: EditFixture): PerformerChangeHost {
  return {
    db: fixture.db,
    h: fixture.h,
    company: fixture.company,
    business: fixture.business,
    branch: fixture.branch,
    changerUserId: fixture.ownerId,
    changerMembershipId: fixture.ownerMembership,
  };
}
