import { afterAll, beforeAll, expect, it } from 'vitest';
import { documentFailure } from '../persistence/document-failures.ts';
import {
  documentFile,
  documentIds,
  documentsFixture,
  recordCommand,
  type DocumentsFixture,
} from './documents.fixture.ts';

let f: DocumentsFixture;
let capturedLogs = '';
const SYNTHETIC = 'SYN-PRIV-777';

it('drops query errors and their bound values before they can reach an error serializer', () => {
  const postgres = Object.assign(new Error(`Bad value: ${SYNTHETIC}`), { code: 'P0001' });
  const query = new Error(`Query parameters: ${SYNTHETIC}`, { cause: postgres });
  const error = documentFailure(query, 'record-employee-document');
  expect(error.message).toBe(
    'DOCUMENT_PERSISTENCE_FAILED (record-employee-document, SQLSTATE P0001)',
  );
  expect(error).not.toHaveProperty('cause');
});
beforeAll(async () => {
  f = await documentsFixture({
    logs: {
      write: (chunk: string) => {
        capturedLogs += chunk;
      },
    },
  });
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const stored = async () => ({
  audit: await f.h
    .owner`SELECT before,after FROM audit_log WHERE company_id=${f.company} AND entity='employee_document'`,
  outbox: await f.h
    .owner`SELECT payload FROM outbox WHERE company_id=${f.company} AND event_type='EmployeeDocumentRecorded'`,
  idempotency: await f.h
    .owner`SELECT response_body FROM idempotency_keys WHERE company_id=${f.company} AND operation='record-employee-document'`,
});

it('DN-05 keeps the number out of audit, outbox and the idempotency response', async () => {
  const result = await f.record.execute(
    recordCommand(f, await documentFile(f), { document_number: SYNTHETIC }),
  );
  expect(JSON.stringify(result)).not.toContain(SYNTHETIC);
  for (const [name, rows] of Object.entries(await stored()))
    expect(JSON.stringify(rows), `${name} must not carry the number`).not.toContain(SYNTHETIC);
});

it('DN-06 refuses an invalid number with a body that never echoes the value', async () => {
  const raw = 'SYN-BAD\u0007VALUE';
  const response = await f.h.send('POST', f.path, {
    cookie: f.cookie,
    company: f.company,
    key: documentIds.newId(),
    body: {
      type_code: 'civil_id',
      file_id: await documentFile(f),
      expires_on: '2026-10-20',
      document_number: raw,
    },
  });
  expect(response.status).toBe(400);
  expect(response.text).not.toContain(raw);
  expect(response.text).not.toContain('SYN-BAD');
});

const blockDocumentWrites = async () => {
  await f.h
    .owner`CREATE FUNCTION test_document_block() RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN RAISE EXCEPTION 'synthetic write block'; END $function$`;
  await f.h
    .owner`CREATE TRIGGER test_document_block BEFORE INSERT ON employee_documents FOR EACH ROW EXECUTE FUNCTION test_document_block()`;
};
const unblockDocumentWrites = async () => {
  await f.h.owner`DROP TRIGGER test_document_block ON employee_documents`;
  await f.h.owner`DROP FUNCTION test_document_block()`;
};

it('DN-07 answers the plain internal envelope on a forced write failure and logs nothing', async () => {
  await blockDocumentWrites();
  let response;
  try {
    response = await f.h.send('POST', f.path, {
      cookie: f.cookie,
      company: f.company,
      key: documentIds.newId(),
      body: {
        type_code: 'civil_id',
        file_id: await documentFile(f),
        expires_on: '2026-10-20',
        document_number: SYNTHETIC,
      },
    });
  } finally {
    await unblockDocumentWrites();
  }
  expect(response.status).toBe(500);
  expect(response.body['code']).toBe('INTERNAL_ERROR');
  expect(response.text).not.toContain(SYNTHETIC);
  expect(capturedLogs).not.toContain(SYNTHETIC);
});

it('DN-08 the forced failure leaves no idempotency row carrying the key or the value', async () => {
  const key = documentIds.newId();
  await blockDocumentWrites();
  try {
    await f.h.send('POST', f.path, {
      cookie: f.cookie,
      company: f.company,
      key,
      body: {
        type_code: 'civil_id',
        file_id: await documentFile(f),
        expires_on: '2026-10-20',
        document_number: SYNTHETIC,
      },
    });
  } finally {
    await unblockDocumentWrites();
  }
  const keys = await f.h
    .owner`SELECT response_body FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
  expect(keys).toHaveLength(0);
  expect(JSON.stringify(await stored())).not.toContain(SYNTHETIC);
});
