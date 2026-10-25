import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { FileValidationError } from '../domain/files.ts';
import { StorageError, StorageObjectMissingError, type ObjectStorage } from '../object-storage.ts';

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
    if (error instanceof StorageObjectMissingError) throw error;
    // أخطاء SDK قد تتضمن المفتاح أو رابطاً موقعاً؛ لا ننقل الرسالة أو cause للـ logger.
    throw new StorageError();
  }
}

// المفتاح الناقص بس هو «مفيش ملف»؛ 404 على bucket غلط عطل تخزين، وأي خطأ تاني انقطاع عادي.
function isMissingObject(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { name?: string }).name === 'NoSuchKey';
}

// الإلغاء بيقطع سحب الـ body؛ من غير كده الطلب بيفضل ينزّل الملف كله في الخلفية بعد ما المحاولة فشلت.
async function bounded(
  body: AsyncIterable<Uint8Array> & { destroy?: () => void },
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (signal?.aborted) {
    body.destroy?.();
    throw new StorageError();
  }
  const onAbort = () => body.destroy?.();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for await (const chunk of body) {
      if (signal?.aborted) throw new StorageError();
      size += chunk.byteLength;
      if (size > maxBytes) throw new FileValidationError('FILE_SIZE_INVALID');
      chunks.push(chunk);
    }
    if (signal?.aborted) throw new StorageError();
    return Buffer.concat(chunks, size);
  } finally {
    signal?.removeEventListener('abort', onAbort);
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

// القراءة بتوقف مع الإشارة، عشان التحميل المعلّق ما يتقاطعش مع محاولة تانية بعد ما المحاولة فشلت.
async function readObject(
  client: S3Client,
  bucket: string,
  key: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (signal?.aborted) throw new StorageError();
  const result = await client
    .send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      signal === undefined ? undefined : { abortSignal: signal },
    )
    .catch((error: unknown) => {
      if (isMissingObject(error)) throw new StorageObjectMissingError();
      throw error;
    });
  const body = result.Body;
  if (body === undefined) throw new StorageError();
  if (result.ContentLength !== undefined && result.ContentLength > maxBytes) {
    (body as { destroy?: () => void }).destroy?.();
    throw new FileValidationError('FILE_SIZE_INVALID');
  }
  return bounded(body as AsyncIterable<Uint8Array>, maxBytes, signal);
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
    read: (Key, maxBytes, signal) =>
      safely(() => readObject(client, Bucket, Key, maxBytes, signal)),
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
