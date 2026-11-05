import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  packagePreviewRequestFixture,
  type PackagePreviewRequestFixture,
} from './package-preview-request.fixture.ts';

let f: PackagePreviewRequestFixture;
beforeAll(async () => {
  f = await packagePreviewRequestFixture();
});
afterAll(async () => {
  await f?.close();
});

it('registers the producer and scoped polling with the 47-1b transport rollout', async () => {
  const file_id = await f.upload();
  const response = await f.h.app.inject({
    method: 'POST',
    url: f.url,
    headers: f.headers,
    payload: { file_id },
  });
  expect(response.statusCode).toBe(202);
  const { preview_id } = response.json() as { preview_id: string };
  const poll = await f.h.app.inject({
    method: 'GET',
    url: `${f.url}/${preview_id}`,
    headers: f.headers,
  });
  expect(poll.statusCode).toBe(200);
  expect(poll.json()).toEqual({ preview_id, status: 'pending' });
  expect(await f.h.owner`SELECT id FROM import_previews WHERE company_id=${f.companyId}`).toEqual(
    [{ id: preview_id }],
  );
  expect(
    await f.h
      .owner`SELECT aggregate_id AS id FROM outbox WHERE company_id=${f.companyId} AND event_type='PackageImportPreviewRequested'`,
  ).toEqual([{ id: preview_id }]);
});
