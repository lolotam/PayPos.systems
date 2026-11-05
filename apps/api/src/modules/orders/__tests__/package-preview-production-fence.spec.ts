import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  packagePreviewRequestFixture,
  type PackagePreviewRequestFixture,
} from './package-preview-request.fixture.ts';

let f: PackagePreviewRequestFixture;
beforeAll(async () => {
  f = await packagePreviewRequestFixture(false);
});
afterAll(async () => {
  await f?.close();
});

it('does not register the producer or polling in production before 47-1b', async () => {
  const file_id = await f.upload();
  const response = await f.h.app.inject({
    method: 'POST',
    url: f.url,
    headers: f.headers,
    payload: { file_id },
  });
  expect(response.statusCode).toBe(404);
  const poll = await f.h.app.inject({
    method: 'GET',
    url: `${f.url}/${f.ids.newId()}`,
    headers: f.headers,
  });
  expect(poll.statusCode).toBe(404);
  expect(await f.h.owner`SELECT id FROM import_previews WHERE company_id=${f.companyId}`).toEqual(
    [],
  );
  expect(
    await f.h
      .owner`SELECT id FROM outbox WHERE company_id=${f.companyId} AND event_type='PackageImportPreviewRequested'`,
  ).toEqual([]);
});
