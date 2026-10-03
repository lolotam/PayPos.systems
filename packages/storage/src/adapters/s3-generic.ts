import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { FileValidationError } from '../domain/files.ts';
import { StorageError, type ObjectStorage } from '../object-storage.ts';

export interface S3Configuration {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

async function safely<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FileValidationError) throw error;
    // أخطاء SDK قد تتضمن المفتاح أو رابطاً موقعاً؛ لا ننقل الرسالة أو cause للـ logger.
    throw new StorageError();
  }
}

async function bounded(
  body: AsyncIterable<Uint8Array> & { destroy?: () => void },
  maxBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of body) {
      size += chunk.byteLength;
      if (size > maxBytes) throw new FileValidationError('FILE_SIZE_INVALID');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } finally {
    body.destroy?.();
  }
}

function s3Client(configuration: S3Configuration): S3Client {
  return new S3Client({
    endpoint: configuration.endpoint,
    region: configuration.region,
    credentials: {
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
    },
    forcePathStyle: configuration.forcePathStyle ?? true,
    maxAttempts: 2,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: { connectionTimeout: 2000, requestTimeout: 10000 },
  });
}

export function createS3Storage(configuration: S3Configuration): ObjectStorage {
  const client = s3Client(configuration);
  const Bucket = configuration.bucket;
  return {
    presignUpload: (Key, ContentType, ContentLength) =>
      safely(() =>
        getSignedUrl(client, new PutObjectCommand({ Bucket, Key, ContentType, ContentLength }), {
          expiresIn: 120,
          signableHeaders: new Set(['content-type', 'content-length']),
        }),
      ),
    presignDownload: (Key, ResponseContentType) =>
      safely(() =>
        getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket,
            Key,
            ResponseContentType,
            ResponseContentDisposition: 'attachment',
          }),
          { expiresIn: 60 },
        ),
      ),
    read: (Key, maxBytes) =>
      safely(async () => {
        const result = await client.send(new GetObjectCommand({ Bucket, Key }));
        const body = result.Body;
        if (body === undefined) throw new StorageError();
        if (result.ContentLength !== undefined && result.ContentLength > maxBytes) {
          (body as { destroy?: () => void }).destroy?.();
          throw new FileValidationError('FILE_SIZE_INVALID');
        }
        return bounded(body as AsyncIterable<Uint8Array>, maxBytes);
      }),
    put: (Key, Body, ContentType) =>
      safely(async () => {
        await client.send(
          new PutObjectCommand({
            Bucket,
            Key,
            Body,
            ContentType,
            ContentLength: Body.byteLength,
            IfNoneMatch: '*',
          }),
        );
      }),
    remove: (Key) =>
      safely(async () => {
        await client.send(new DeleteObjectCommand({ Bucket, Key }));
      }),
    close: () => client.destroy(),
  };
}
