import { afterAll, beforeAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import {
  buildObjectKey,
  createS3Storage,
  fitImage,
  type ObjectStorage,
} from '@pospay/storage';

import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { PROVISIONAL_PLAN_ID } from '../../../../../../packages/db/src/seed.ts';
import { fakeS3, fakeCredentials } from '../../../../../../packages/storage/test/fake-s3.ts';
import { pngImage } from './png-image.ts';
import { statementLogoRepository } from '../persistence/statement-logo.repository.ts';
import { statementLogoStorage } from '../persistence/statement-logo-storage.adapter.ts';
import { ReadStatementLogo } from '../use-cases/read-statement-logo/read-statement-logo.ts';

export const ids = systemUuidV7();
export let testDb: TestDatabase, db: Database, owner: postgres.Sql;
export let fake: Awaited<ReturnType<typeof fakeS3>>, storage: ObjectStorage;
export let company: string, business: string, otherBusiness: string, now: Date;
export const clock = { now: () => now };

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  fake = await fakeS3();
  storage = createS3Storage({
    endpoint: fake.endpoint,
    region: 'auto',
    bucket: 'private',
    ...fakeCredentials,
  });
});
beforeEach(async () => {
  now = new Date('2026-10-10T12:00:00Z');
  company = ids.newId();
  business = ids.newId();
  otherBusiness = ids.newId();
  await owner`INSERT INTO companies(id,owner_user_id,plan_id,name_en) VALUES (${company},${USER},${PROVISIONAL_PLAN_ID},'Synthetic statement logo')`;
  await owner`INSERT INTO businesses(company_id,id,vertical_type,name_en) VALUES (${company},${business},'salon','Synthetic statement logo')`;
  await owner`INSERT INTO businesses(company_id,id,vertical_type,name_en) VALUES (${company},${otherBusiness},'salon','Synthetic other business')`;
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  storage?.close();
  await fake?.close();
  await testDb?.drop();
});

// JPEG حقيقي: بيرميز نفس الـ PNG بـ fitImage، وده الترميز الوحيد المتاح من غير sharp.
export async function jpegImage(width: number, height: number): Promise<Buffer> {
  const encoded = await fitImage(pngImage(width, height), 'image/jpeg', {
    maxSide: width,
    maxBytes: 10 * 1024 * 1024,
  });
  return Buffer.from(encoded);
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export interface LogoPatch {
  contentType?: 'image/png' | 'image/jpeg';
  status?: string;
  ownerModule?: string;
  ownerEntityId?: string;
  businessId?: string;
  purgeStarted?: boolean;
  put?: boolean;
}

export async function seedLogo(patch: LogoPatch = {}) {
  const id = ids.newId();
  const key = buildObjectKey(company, business, id, 'verified');
  const contentType = patch.contentType ?? 'image/png';
  const bytes =
    contentType === 'image/png' ? pngImage(1200, 600) : await jpegImage(1200, 600);
  if (patch.put !== false) await storage.put(key, bytes, contentType);
  const status = patch.status ?? 'READY';
  await owner`INSERT INTO file_objects(company_id,id,business_id,branch_id,owner_module,owner_entity_id,
      staging_key,storage_key,content_type,size_bytes,required_permission,created_by,created_at,status,purge_started_at)
    VALUES (${company},${id},${patch.businessId ?? business},null,${patch.ownerModule ?? 'settings'},
      ${patch.ownerEntityId ?? business},${`staging-${id}`},${status === 'READY' ? key : null},${contentType},
      ${bytes.length},'manage:business-identity:business',${USER},${now},${status},
      ${patch.purgeStarted === true ? now : null})`;
  return { id, key };
}

export function reader(target: ObjectStorage = storage) {
  return new ReadStatementLogo(
    statementLogoRepository(db, ids),
    statementLogoStorage(target),
    clock,
  );
}

export function request(fileId: string, renderId = ids.newId()) {
  return { businessId: business, fileId, requesterUserId: USER, renderId };
}
