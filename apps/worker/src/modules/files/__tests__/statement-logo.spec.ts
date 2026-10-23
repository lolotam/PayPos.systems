import { expect, it } from 'vitest';
import { StorageError } from '@pospay/storage';

import { TENANT, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { pngSize } from './png-image.ts';
import {
  company,
  ids,
  isJpeg,
  now,
  otherBusiness,
  owner,
  reader,
  request,
  seedLogo,
  storage,
  type LogoPatch,
} from './statement-logo.fixture.ts';

const accessRows = () =>
  owner`SELECT id, file_id, actor_user_id, accessed_at, outcome FROM file_access_audit
    WHERE company_id = ${company} ORDER BY id`;

const auditRows = () =>
  owner`SELECT actor_user_id, entity, entity_id, action, after FROM audit_log
    WHERE company_id = ${company} AND entity = 'file' ORDER BY at, id`;

it('reads the logo once, records one access row and one audit entry for the render', async () => {
  const logo = await seedLogo();
  const render = request(logo.id);
  const result = await reader().execute(company, render);
  expect(result?.content_type).toBe('image/png');
  const size = pngSize(result?.bytes ?? new Uint8Array());
  expect(size.width).toBe(512);
  expect(size.height).toBe(256);
  expect(result?.bytes.byteLength).toBeLessThanOrEqual(512 * 1024);
  const access = await accessRows();
  expect(access).toHaveLength(1);
  expect(access[0]).toMatchObject({
    id: render.renderId,
    file_id: logo.id,
    actor_user_id: USER,
    outcome: 'ALLOW',
  });
  expect(new Date(access[0]?.['accessed_at'] as string | Date).getTime()).toBe(now.getTime());
  const audits = await auditRows();
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    actor_user_id: USER,
    entity: 'file',
    entity_id: logo.id,
    action: 'access',
  });
  expect(audits[0]?.['after']).toEqual({ outcome: 'ALLOW' });
});

it('a retry with the same render id embeds the same logo and adds no row', async () => {
  const logo = await seedLogo();
  const render = request(logo.id);
  const first = await reader().execute(company, render);
  const second = await reader().execute(company, render);
  expect(second?.content_type).toBe('image/png');
  expect(pngSize(second?.bytes ?? new Uint8Array())).toEqual(
    pngSize(first?.bytes ?? new Uint8Array()),
  );
  expect(await accessRows()).toHaveLength(1);
  expect(await auditRows()).toHaveLength(1);
});

it('a second render of the same file adds one access row and one audit entry', async () => {
  const logo = await seedLogo();
  await reader().execute(company, request(logo.id));
  await reader().execute(company, request(logo.id));
  expect(await accessRows()).toHaveLength(2);
  expect(await auditRows()).toHaveLength(2);
});

it('a failed attempt leaves one access row, and the retry with the same render id embeds the logo', async () => {
  const logo = await seedLogo();
  const render = request(logo.id);
  const failing = reader({
    ...storage,
    read: async () => {
      throw new StorageError();
    },
  });
  await expect(failing.execute(company, render)).rejects.toMatchObject({
    code: 'STORAGE_UNAVAILABLE',
  });
  const result = await reader().execute(company, render);
  expect(result?.content_type).toBe('image/png');
  expect(await accessRows()).toHaveLength(1);
  expect(await auditRows()).toHaveLength(1);
});

it('a file that no longer qualifies returns nothing and writes no row', async () => {
  const cases: LogoPatch[] = [
    { status: 'PENDING' },
    { purgeStarted: true },
    { ownerModule: 'staff' },
    { ownerEntityId: ids.newId() },
    { businessId: otherBusiness },
  ];
  for (const patch of cases) {
    const logo = await seedLogo(patch);
    const result = await reader().execute(company, request(logo.id));
    expect(result).toBeNull();
  }
  expect(await accessRows()).toHaveLength(0);
  expect(await auditRows()).toHaveLength(0);
});

it('a missing object returns nothing, and the access row of the lookup stays', async () => {
  const logo = await seedLogo({ put: false });
  const result = await reader().execute(company, request(logo.id));
  expect(result).toBeNull();
  expect(await accessRows()).toHaveLength(1);
  expect(await auditRows()).toHaveLength(1);
});

it('a JPEG logo comes back as image/jpeg', async () => {
  const logo = await seedLogo({ contentType: 'image/jpeg' });
  const result = await reader().execute(company, request(logo.id));
  expect(result?.content_type).toBe('image/jpeg');
  expect(isJpeg(result?.bytes ?? new Uint8Array())).toBe(true);
});

it('another company cannot read this company file and writes nothing', async () => {
  const logo = await seedLogo();
  const result = await reader().execute(TENANT.B.company, request(logo.id));
  expect(result).toBeNull();
  const foreign = await owner`SELECT count(*)::int AS n FROM file_access_audit
    WHERE company_id = ${TENANT.B.company}`;
  expect(foreign[0]?.['n']).toBe(0);
  const foreignAudits = await owner`SELECT count(*)::int AS n FROM audit_log
    WHERE company_id = ${TENANT.B.company} AND entity = 'file'`;
  expect(foreignAudits[0]?.['n']).toBe(0);
});
