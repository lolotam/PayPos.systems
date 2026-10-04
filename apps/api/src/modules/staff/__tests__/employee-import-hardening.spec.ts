import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { FILE_UPLOAD_POLICY, FileValidationError, inspectContent } from '@pospay/storage';
import {
  EmployeeImportError,
  EMPLOYEE_IMPORT_CONTENT_TYPE,
  EMPLOYEE_IMPORT_MAX_BYTES,
} from '../domain/employee-import.ts';
import { createEmployeeImportTransactions } from '../persistence/drizzle-employee-import.ts';
import {
  createImportSheetReader,
  createObjectBytesReader,
} from '../persistence/import-adapters.ts';
import { PreviewEmployeeImportUseCase } from '../use-cases/preview-employee-import/preview-employee-import.usecase.ts';
import { ApiError } from '../../../shared/errors.ts';
import {
  commitCommand,
  employeeImportFixture,
  employeeWorkbook,
  previewCommand,
  type EmployeeImportFixture,
} from './employee-import.fixture.ts';

let f: EmployeeImportFixture;
const ids = systemUuidV7();
const VALID = [['Synthetic hardening', null, 'staff', '2026-01-01', null, 'Main']] as const;
beforeAll(async () => {
  f = await employeeImportFixture();
});
afterAll(async () => {
  await f?.h.close();
});

function previewWithStorage(read: (key: string, max: number) => Promise<Uint8Array>) {
  return new PreviewEmployeeImportUseCase(
    createEmployeeImportTransactions(f.db, ids),
    createObjectBytesReader({ read }),
    createImportSheetReader(),
    ids,
    { now: () => f.clock.value },
  );
}

it('inspects a real workbook using the production upload policy', async () => {
  const bytes = await employeeWorkbook(VALID);
  expect(
    await inspectContent(
      bytes,
      { type: EMPLOYEE_IMPORT_CONTENT_TYPE, size: bytes.byteLength },
      FILE_UPLOAD_POLICY,
    ),
  ).toEqual({ bytes, type: EMPLOYEE_IMPORT_CONTENT_TYPE });
  const fileId = await f.upload(bytes);
  const [file] = await f.h
    .owner`SELECT owner_module,required_permission FROM file_objects WHERE id=${fileId}`;
  expect(file).toMatchObject({ owner_module: 'staff', required_permission: 'read:files:business' });
});

it.each([
  [new FileValidationError('FILE_SIZE_INVALID'), 'IMPORT_FILE_CONTENT_INVALID', 422],
  [new Error('Synthetic storage outage'), 'STORAGE_UNAVAILABLE', 503],
] as const)(
  'maps storage refusal to the named bilingual API envelope',
  async (failure, code, status) => {
    const file = await f.upload(await employeeWorkbook(VALID));
    const preview = previewWithStorage(async () => {
      throw failure;
    });
    await expect(preview.execute(previewCommand(f, file))).rejects.toMatchObject({ code });
    const envelope = new ApiError(code);
    expect(envelope.status).toBe(status);
    expect(envelope.toEnvelope()).toMatchObject({
      code,
      message_ar: expect.any(String),
      message_en: expect.any(String),
    });
  },
);

it('rejects a detected xlsx zip with missing workbook parts as invalid content', async () => {
  const bytes = Buffer.from(await employeeWorkbook(VALID));
  const original = Buffer.from('xl/workbook.xml');
  let at = bytes.indexOf(original);
  while (at !== -1) {
    Buffer.from('xl/missingx.xml').copy(bytes, at);
    at = bytes.indexOf(original, at + original.length);
  }
  await inspectContent(
    bytes,
    { type: EMPLOYEE_IMPORT_CONTENT_TYPE, size: bytes.byteLength },
    FILE_UPLOAD_POLICY,
  );
  const file = await f.upload(bytes);
  await expect(f.preview.execute(previewCommand(f, file))).rejects.toMatchObject({
    code: 'IMPORT_FILE_CONTENT_INVALID',
  });
});

it('rejects an object that grew beyond the facts size at preview time', async () => {
  const file = await f.upload(await employeeWorkbook(VALID));
  const preview = previewWithStorage(async () => new Uint8Array(EMPLOYEE_IMPORT_MAX_BYTES + 1));
  await expect(preview.execute(previewCommand(f, file))).rejects.toMatchObject({
    code: 'IMPORT_FILE_CONTENT_INVALID',
  });
});

it('hides cross-tenant file and preview ids exactly like unknown ids through the use cases', async () => {
  const cookie = await f.h.signedInOperator('foreign-import-owner@example.test');
  const company = await f.h.onboard(cookie, 'Synthetic foreign import company');
  const [user] = await f.h
    .owner`SELECT id FROM "user" WHERE email='foreign-import-owner@example.test'`;
  const business = ids.newId();
  const file = ids.newId();
  const preview = ids.newId();
  await f.h
    .owner`INSERT INTO businesses(company_id,id,name_en,vertical_type) VALUES (${company},${business},'Synthetic foreign business','salon')`;
  await f.h
    .owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,staging_key,storage_key,content_type,size_bytes,required_permission,created_by,created_at,status)
    VALUES (${company},${file},${business},'staff',${business},${`staging/${file}`},${`verified/${file}`},${EMPLOYEE_IMPORT_CONTENT_TYPE},100,'read:files:business',${user?.['id'] as string},now(),'READY')`;
  await f.h
    .owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors)
    VALUES (${company},${preview},${business},'employees',${file},${user?.['id'] as string},now(),now()+interval '24 hours',0,0,'[]','[]')`;
  for (const id of [file, ids.newId()])
    await expect(f.preview.execute(previewCommand(f, id))).rejects.toEqual(
      new EmployeeImportError('IMPORT_FILE_NOT_FOUND'),
    );
  for (const id of [preview, ids.newId()])
    await expect(f.commit.execute(commitCommand(f, id, ids.newId()))).rejects.toEqual(
      new EmployeeImportError('IMPORT_PREVIEW_NOT_FOUND'),
    );
  const [companyOwner] = await f.h
    .owner`SELECT id FROM "user" WHERE email='import-owner@example.test'`;
  for (const businessId of [business, ids.newId()]) {
    const command = { companyId: f.company, userId: companyOwner?.['id'] as string, businessId };
    await expect(f.template.execute(command)).rejects.toEqual(
      new EmployeeImportError('EMPLOYEE_BRANCH_NOT_FOUND'),
    );
    await expect(f.preview.execute({ ...command, fileId: file })).rejects.toEqual(
      new EmployeeImportError('EMPLOYEE_BRANCH_NOT_FOUND'),
    );
  }
});

it('matches create-employee by accepting inactive branches and stable ids after rename', async () => {
  const file = await f.upload(await employeeWorkbook(VALID));
  const preview = await f.preview.execute(previewCommand(f, file));
  await f.h
    .owner`UPDATE branches SET is_active=false,name_en='Renamed synthetic main' WHERE id=${f.branch}`;
  try {
    const result = await f.commit.execute(commitCommand(f, preview.preview_id, 'inactive-branch'));
    expect(result.preview_id).toBe(preview.preview_id);
    await f.worker.execute(f.company, preview.preview_id);
    const [status] = await f.h
      .owner`SELECT status,created_count FROM import_previews WHERE id=${preview.preview_id}`;
    expect(status).toMatchObject({ status: 'committed', created_count: 1 });
    const inactivePreview = await f.preview.execute(
      previewCommand(
        f,
        await f.upload(
          await employeeWorkbook([
            ['Inactive', null, 'staff', '2026-01-01', null, 'Renamed synthetic main'],
          ]),
        ),
      ),
    );
    expect(inactivePreview.error_count).toBe(0);
  } finally {
    await f.h.owner`UPDATE branches SET is_active=true,name_en='Main' WHERE id=${f.branch}`;
  }
});

it('requires live permission before replay and hides another managers preview, including replay', async () => {
  const preview = await f.preview.execute(
    previewCommand(f, await f.upload(await employeeWorkbook(VALID))),
  );
  const command = commitCommand(f, preview.preview_id, 'protected-replay');
  await f.commit.execute(command);
  const [owner] = await f.h.owner`SELECT id FROM "user" WHERE email='import-owner@example.test'`;
  await expect(
    f.commit.execute({ ...command, userId: owner?.['id'] as string }),
  ).rejects.toMatchObject({ code: 'IMPORT_PREVIEW_NOT_FOUND' });
  await f.h
    .owner`UPDATE permission_overrides SET effect='DENY' WHERE company_id=${f.company} AND membership_id=${f.memberId}`;
  try {
    await expect(f.commit.execute(command)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await f.h
      .owner`UPDATE permission_overrides SET effect='ALLOW' WHERE company_id=${f.company} AND membership_id=${f.memberId}`;
  }
});

it('template and preview reads do not wait for membership write locks', async () => {
  const file = await f.upload(await employeeWorkbook(VALID));
  await f.h.owner.begin(async (tx) => {
    await tx`SELECT id FROM companies WHERE id=${f.company} FOR NO KEY UPDATE`;
    await tx`SELECT id FROM memberships WHERE company_id=${f.company} FOR UPDATE`;
    const work = Promise.all([
      f.template.execute({ companyId: f.company, userId: f.userId, businessId: f.business }),
      f.preview.execute(previewCommand(f, file)),
    ]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Read path waited for membership locks')),
            1000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  });
});
