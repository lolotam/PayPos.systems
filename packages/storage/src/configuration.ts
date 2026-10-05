import { createS3Storage, type S3Configuration } from './adapters/s3-generic.ts';
import { FILE_UPLOAD_POLICY, type UploadPolicy } from './domain/files.ts';

export function readStorageConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): { s3: S3Configuration; policy: UploadPolicy } | null {
  const names = [
    'STORAGE_ENDPOINT',
    'STORAGE_BUCKET',
    'STORAGE_ACCESS_KEY_ID',
    'STORAGE_SECRET_ACCESS_KEY',
  ] as const;
  if (names.some((name) => !env[name]?.trim())) return null;
  try {
    const endpoint = new URL(env['STORAGE_ENDPOINT'] ?? '');
    if (
      !['https:', 'http:'].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      return null;
    if (env['NODE_ENV'] === 'production' && endpoint.protocol !== 'https:') return null;
    return {
      s3: {
        endpoint: endpoint.href,
        bucket: env['STORAGE_BUCKET'] ?? '',
        region: env['STORAGE_REGION'] || 'auto',
        accessKeyId: env['STORAGE_ACCESS_KEY_ID'] ?? '',
        secretAccessKey: env['STORAGE_SECRET_ACCESS_KEY'] ?? '',
      },
      policy: FILE_UPLOAD_POLICY,
    };
  } catch {
    return null;
  }
}

export function optionalStorage(env: Readonly<Record<string, string | undefined>>) {
  const config = readStorageConfiguration(env);
  return config === null ? null : { storage: createS3Storage(config.s3), policy: config.policy };
}
