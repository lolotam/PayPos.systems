import { employeeDocument } from '@pospay/contracts';
import { IdempotencyKeyReusedError } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  documentFile,
  documentIds,
  documentsFixture,
  recordCommand,
  type DocumentsFixture,
} from './documents.fixture.ts';

let f: DocumentsFixture;
beforeAll(async () => {
  f = await documentsFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const failure = async (work: Promise<unknown>) => {
  try {
    await work;
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).name;
  }
  return 'NO_ERROR';
};
const rows = (employeeId = f.employee.id) =>
  f.h
    .owner`SELECT id,type_code,object_key,to_char(expires_on,'YYYY-MM-DD') AS expires_on,replaced_at
    FROM employee_documents WHERE company_id=${f.company} AND employee_id=${employeeId} ORDER BY recorded_at, id`;

it('refuses a verified XLSX as an employee document with a named bilingual envelope and no writes', async () => {
  const file = await documentFile(f, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const before = await rows();
  expect(await failure(f.record.execute(recordCommand(f, file)))).toBe(
    'DOCUMENT_FILE_TYPE_INVALID',
  );
  expect(await rows()).toEqual(before);
  const response = await f.h.send('POST', f.path, {
    cookie: f.cookie,
    company: f.company,
    key: documentIds.newId(),
    body: recordCommand(f, file).input,
  });
  expect(response).toMatchObject({
    status: 422,
    body: {
      code: 'DOCUMENT_FILE_TYPE_INVALID',
      message_ar: expect.any(String),
      message_en: expect.any(String),
    },
  });
});

it('records a READY file the recorder uploaded: key stored, status in the business day, audit and event keyless', async () => {
  const fileId = await documentFile(f);
  const result = await f.record.execute(recordCommand(f, fileId));
  expect(employeeDocument.parse(result)).toEqual(result);
  expect(result).toMatchObject({
    type_code: 'civil_id',
    type_name_en: 'Synthetic civil_id',
    object_key: `${f.company}/${f.business}/${fileId}/verified`,
    expires_on: '2026-10-20',
    uploaded_by: f.userId,
    recorded_at: '2026-10-04T21:30:00.000Z',
    status: 'EXPIRING',
  });
  const [audit] = await f.h.owner`SELECT actor_user_id, before, after FROM audit_log
    WHERE company_id=${f.company} AND entity='employee_document' AND entity_id=${result.id}`;
  expect(audit?.['actor_user_id']).toBe(f.userId);
  expect(audit?.['before']).toBeNull();
  const [event] = await f.h.owner`SELECT aggregate_id, payload FROM outbox
    WHERE company_id=${f.company} AND event_type='EmployeeDocumentRecorded'`;
  expect(event?.['aggregate_id']).toBe(f.employee.id);
  expect(event?.['payload']).toMatchObject({ document_id: result.id, replaced_document_id: null });
  expect(JSON.stringify([audit, event])).not.toContain('verified');
});

it('replaces the current document of the type and keeps the old one as history', async () => {
  const before = await rows();
  const first = before.find((r) => r['replaced_at'] === null);
  const result = await f.record.execute(
    recordCommand(f, await documentFile(f), { expires_on: '2020-01-31' }),
  );
  expect(result.status).toBe('EXPIRED');
  const after = await rows();
  expect(after).toHaveLength(before.length + 1);
  expect(after.filter((r) => r['replaced_at'] === null).map((r) => r['id'])).toEqual([result.id]);
  expect(after.find((r) => r['id'] === first?.['id'])?.['replaced_at']).not.toBeNull();
  const [event] = await f.h.owner`SELECT payload FROM outbox WHERE company_id=${f.company}
    AND event_type='EmployeeDocumentRecorded' AND payload->>'document_id'=${result.id}`;
  expect(event?.['payload']).toMatchObject({ replaced_document_id: first?.['id'] });
});

it('enforces the type rules: required expiry, optional expiry and inactive or unknown types', async () => {
  expect(
    await failure(f.record.execute(recordCommand(f, await documentFile(f), { expires_on: null }))),
  ).toBe('DOCUMENT_EXPIRY_REQUIRED');
  const contract = await f.record.execute(
    recordCommand(f, await documentFile(f), { type_code: 'work_contract', expires_on: null }),
  );
  expect(contract.status).toBe('NO_EXPIRY');
  await f.h
    .owner`UPDATE document_types SET active=false WHERE company_id=${f.company} AND code='passport'`;
  for (const type_code of ['passport', 'visa'])
    expect(
      await failure(f.record.execute(recordCommand(f, await documentFile(f), { type_code }))),
    ).toBe('DOCUMENT_TYPE_UNAVAILABLE');
});

it('treats every file that was not uploaded by this recorder for this employee as unknown', async () => {
  const cases = [
    documentIds.newId(),
    await documentFile(f, { entity: f.other.id }),
    await documentFile(f, { module: 'customers' }),
    await documentFile(f, { business: f.secondBusiness }),
    await documentFile(f, { createdBy: f.memberId }),
    await documentFile(f, { permission: 'manage:files:business' }),
  ];
  for (const fileId of cases)
    expect(await failure(f.record.execute(recordCommand(f, fileId)))).toBe('NOT_FOUND');
  expect(
    await failure(f.record.execute(recordCommand(f, await documentFile(f, { status: 'PENDING' })))),
  ).toBe('FILE_NOT_READY');
  const unknownEmployee = recordCommand(f, await documentFile(f), {}, documentIds.newId());
  expect(await failure(f.record.execute(unknownEmployee))).toBe('NOT_FOUND');
  const foreign = { ...recordCommand(f, await documentFile(f)), businessId: f.secondBusiness };
  expect(await failure(f.record.execute(foreign))).toBe('NOT_FOUND');
});

it('a file is recorded once; a retried key replays and a changed request with the key is refused', async () => {
  const fileId = await documentFile(f);
  const command = recordCommand(f, fileId, {
    type_code: 'work_contract',
    expires_on: '2030-01-01',
  });
  const first = await f.record.execute(command);
  const count = (await rows()).length;
  expect(await f.record.execute(command)).toEqual(first);
  expect(await rows()).toHaveLength(count);
  expect(await failure(f.record.execute({ ...command, fingerprint: 'c'.repeat(64) }))).toBe(
    new IdempotencyKeyReusedError().name,
  );
  expect(
    await failure(f.record.execute(recordCommand(f, fileId, { type_code: 'work_contract' }))),
  ).toBe('DOCUMENT_FILE_ALREADY_RECORDED');
});

it('concurrent records of one type serialize: one current document, the other kept as history', async () => {
  const [a, b] = [
    await documentFile(f, { entity: f.other.id }),
    await documentFile(f, { entity: f.other.id }),
  ];
  const results = await Promise.all(
    [a, b].map((fileId) => f.record.execute(recordCommand(f, fileId, {}, f.other.id))),
  );
  const stored = await rows(f.other.id);
  expect(stored).toHaveLength(2);
  expect(stored.filter((r) => r['replaced_at'] === null)).toHaveLength(1);
  expect(results.map((r) => r.id).sort()).toEqual(stored.map((r) => r['id']).sort());
});
