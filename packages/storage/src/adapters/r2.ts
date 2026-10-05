import { createS3Storage, type S3Configuration } from './s3-generic.ts';

export function createR2Storage(config: Omit<S3Configuration, 'region'>) {
  return createS3Storage({ ...config, region: 'auto' });
}
