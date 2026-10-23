import { afterAll, beforeAll, expect, it } from 'vitest';
import sharp from 'sharp';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createS3Storage } from '../adapters/s3-generic.ts';
import { inspectContent } from '../inspection.ts';
import { StorageError, StorageObjectMissingError } from '../object-storage.ts';
import { fakeCredentials, fakeS3 } from '../../test/fake-s3.ts';

let fake: Awaited<ReturnType<typeof fakeS3>>;
let storage: ReturnType<typeof createS3Storage>;
beforeAll(async () => {
  fake = await fakeS3();
  storage = createS3Storage({
    endpoint: fake.endpoint,
    region: 'auto',
    bucket: 'private',
    ...fakeCredentials,
  });
});
afterAll(async () => {
  storage?.close();
  await fake?.close();
});
// سيرفر صغير بيجاوب بخطأ معيّن على كل طلب، عشان نثبت إن خطأ القراءة غير المفقود بيفضل انقطاعاً.
async function failingStorage(status: number, body: string) {
  const server = createServer((_request, response) => {
    response.writeHead(status, { 'content-type': 'application/xml' });
    response.end(body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('FAKE_S3_ADDRESS');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
it('signs exact type and size for 120 seconds; wrong headers are refused', async () => {
  const url = await storage.presignUpload('staging/one', 'application/pdf', 4);
  const query = new URL(url).searchParams;
  expect(query.get('X-Amz-Expires')).toBe('120');
  expect(query.get('X-Amz-SignedHeaders')).toContain('content-length');
  expect(query.get('X-Amz-SignedHeaders')).toContain('content-type');
  expect(
    (
      await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body: Buffer.from('1234'),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/pdf' },
        body: Buffer.from('12345'),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/pdf' },
        body: Buffer.from('1234'),
      })
    ).status,
  ).toBe(200);
  expect(Buffer.from(await storage.read('staging/one', 4))).toEqual(Buffer.from('1234'));
  await expect(storage.read('staging/one', 3)).rejects.toThrow('FILE_SIZE_INVALID');
});
it('private publication is create-only; GET expiry is 60 seconds and attachment', async () => {
  await storage.put('verified/one', Buffer.from('safe'), 'application/pdf');
  await expect(
    storage.put('verified/one', Buffer.from('changed'), 'application/pdf'),
  ).rejects.toThrow('STORAGE_UNAVAILABLE');
  const url = await storage.presignDownload('verified/one', 'application/pdf');
  expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('60');
  const download = await fetch(url);
  expect(download.status).toBe(200);
  expect(download.headers.get('content-disposition')).toBe('attachment');
  expect(await download.text()).toBe('safe');
  expect(
    fake.requests
      .filter((r) => r.method === 'PUT')
      .every((r) => r.headers['x-amz-acl'] === undefined),
  ).toBe(true);
  await storage.remove('verified/one');
  await expect(storage.read('verified/one', 10)).rejects.toThrow('STORAGE_UNAVAILABLE');
  await expect(storage.read('verified/one', 10)).rejects.toBeInstanceOf(StorageObjectMissingError);
});
it('a read with a wrong signature is an outage, not a missing object', async () => {
  const wrong = createS3Storage({
    endpoint: fake.endpoint,
    region: 'auto',
    bucket: 'private',
    accessKeyId: fakeCredentials.accessKeyId,
    secretAccessKey: 'synthetic-wrong-secret-only',
  });
  try {
    const failure = await wrong.read('verified/one', 10).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StorageError);
    expect(failure).not.toBeInstanceOf(StorageObjectMissingError);
  } finally {
    wrong.close();
  }
});
it('a 404 on a missing bucket is an outage, not a missing object', async () => {
  const server = await failingStorage(404, '<Error><Code>NoSuchBucket</Code></Error>');
  const broken = createS3Storage({
    endpoint: server.endpoint,
    region: 'auto',
    bucket: 'private',
    ...fakeCredentials,
  });
  try {
    const failure = await broken.read('verified/one', 10).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StorageError);
    expect(failure).not.toBeInstanceOf(StorageObjectMissingError);
  } finally {
    broken.close();
    await server.close();
  }
});
it('a 500 from the storage is an outage, not a missing object', async () => {
  const server = await failingStorage(500, '<Error><Code>InternalError</Code></Error>');
  const broken = createS3Storage({
    endpoint: server.endpoint,
    region: 'auto',
    bucket: 'private',
    ...fakeCredentials,
  });
  try {
    const failure = await broken.read('verified/one', 10).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StorageError);
    expect(failure).not.toBeInstanceOf(StorageObjectMissingError);
  } finally {
    broken.close();
    await server.close();
  }
});
it('detects content instead of headers and fully re-encodes an image without metadata', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#112233' } })
    .png()
    .withMetadata()
    .toBuffer();
  const policy = { 'image/png': 10000, 'application/pdf': 10000 };
  await expect(
    inspectContent(png, { type: 'application/pdf', size: png.length }, policy),
  ).rejects.toThrow('FILE_TYPE_INVALID');
  await expect(
    inspectContent(png, { type: 'image/png', size: png.length + 1 }, policy),
  ).rejects.toThrow('FILE_SIZE_INVALID');
  const encoded = await inspectContent(png, { type: 'image/png', size: png.length }, policy);
  expect(encoded.bytes).not.toEqual(new Uint8Array(png));
  const metadata = await sharp(encoded.bytes).metadata();
  expect(metadata).toMatchObject({ width: 2, height: 2, format: 'png' });
  expect(metadata.exif).toBeUndefined();
  expect(metadata.icc).toBeUndefined();
  await expect(
    inspectContent(Buffer.from('plain text'), { type: 'image/png', size: 10 }, policy),
  ).rejects.toThrow('FILE_TYPE_INVALID');
  const pdf = Buffer.from('%PDF-1.7\nsynthetic\n%%EOF');
  expect(await inspectContent(pdf, { type: 'application/pdf', size: pdf.length }, policy)).toEqual({
    bytes: pdf,
    type: 'application/pdf',
  });
});
