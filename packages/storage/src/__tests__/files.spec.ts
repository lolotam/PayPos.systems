import { describe, expect, it } from 'vitest';
import {
  FILE_UPLOAD_POLICY,
  buildObjectKey,
  validateContent,
  validateUpload,
} from '../domain/files.ts';
import { readStorageConfiguration } from '../configuration.ts';

const A = '01920000-0000-7000-8000-0000000000a0';
const B = '01920000-0000-7000-8000-0000000000a1';
const ID = '01920000-0000-7000-8000-000000000abc';
const policy = { 'application/pdf': 100, 'image/png': 200 };
describe('generated keys and explicit upload policy', () => {
  it('separates staging and verified and normalizes ids', () => {
    expect(buildObjectKey(A.toUpperCase(), B, ID, 'staging')).toBe(`${A}/${B}/staging/${ID}`);
    expect(buildObjectKey(A, B, ID, 'verified')).not.toBe(buildObjectKey(A, B, ID, 'staging'));
  });
  it.each(['../escape', 'a/b', '', '01920000-0000-4000-8000-000000000abc'])(
    'refuses key component %s',
    (id) => {
      for (const args of [
        [id, B, ID],
        [A, id, ID],
        [A, B, id],
      ])
        expect(() =>
          buildObjectKey(args[0] ?? '', args[1] ?? '', args[2] ?? '', 'staging'),
        ).toThrow('FILE_KEY_INVALID');
    },
  );
  it('fails closed on unknown and unsupported image types', () => {
    expect(() => validateUpload({}, 'application/pdf', 1)).toThrow('FILE_TYPE_INVALID');
    expect(() => validateUpload({ 'image/svg+xml': 100 }, 'image/svg+xml', 1)).toThrow(
      'FILE_TYPE_INVALID',
    );
    expect(() => validateUpload(policy, 'toString', 1)).toThrow('FILE_TYPE_INVALID');
  });
  it.each([0, -1, 101, 1.1, NaN, Infinity])('rejects byte count %s', (size) =>
    expect(() => validateUpload(policy, 'application/pdf', size)).toThrow('FILE_SIZE_INVALID'),
  );
  it('includes the exact cap and compares byte-detected type and claimed size', () => {
    expect(validateUpload(policy, 'application/pdf', 100)).toBe(100);
    expect(() =>
      validateContent(
        policy,
        { type: 'application/pdf', size: 10 },
        { type: 'image/png', size: 10 },
      ),
    ).toThrow('FILE_TYPE_INVALID');
    expect(() =>
      validateContent(
        policy,
        { type: 'application/pdf', size: 10 },
        { type: 'application/pdf', size: 11 },
      ),
    ).toThrow('FILE_SIZE_INVALID');
    expect(() =>
      validateContent(policy, { type: 'application/pdf', size: 10 }, { type: undefined, size: 10 }),
    ).toThrow('FILE_TYPE_INVALID');
    expect(() =>
      validateContent(
        policy,
        { type: 'application/pdf', size: 10 },
        { type: 'application/pdf', size: 10 },
      ),
    ).not.toThrow();
  });
  it('empty, malformed and partial optional configuration never throw', () => {
    expect(readStorageConfiguration({})).toBeNull();
    expect(readStorageConfiguration({ STORAGE_ENDPOINT: 'broken' })).toBeNull();
  });
});

it('owner decision 2026-10-03 enables exactly PDF/JPEG/PNG at 10 MiB without a policy setting', () => {
  const config = readStorageConfiguration({
    STORAGE_ENDPOINT: 'https://storage.synthetic.invalid',
    STORAGE_BUCKET: 'private',
    STORAGE_ACCESS_KEY_ID: 'synthetic-key',
    STORAGE_SECRET_ACCESS_KEY: 'synthetic-secret',
  });
  expect(config?.policy).toEqual(FILE_UPLOAD_POLICY);
  for (const type of ['application/pdf', 'image/jpeg', 'image/png']) {
    expect(validateUpload(FILE_UPLOAD_POLICY, type, 10 * 1024 * 1024)).toBe(10 * 1024 * 1024);
    expect(() => validateUpload(FILE_UPLOAD_POLICY, type, 10 * 1024 * 1024 + 1)).toThrow(
      'FILE_SIZE_INVALID',
    );
  }
  for (const type of ['image/webp', 'text/plain', 'image/svg+xml', 'application/zip'])
    expect(() => validateUpload(FILE_UPLOAD_POLICY, type, 1)).toThrow('FILE_TYPE_INVALID');
  expect(
    readStorageConfiguration({
      STORAGE_ENDPOINT: 'https://storage.synthetic.invalid',
      STORAGE_BUCKET: 'private',
      STORAGE_ACCESS_KEY_ID: 'synthetic-key',
      STORAGE_SECRET_ACCESS_KEY: 'synthetic-secret',
      STORAGE_UPLOAD_POLICY: '{"image/webp":99999999}',
    })?.policy,
  ).toEqual(FILE_UPLOAD_POLICY);
});
