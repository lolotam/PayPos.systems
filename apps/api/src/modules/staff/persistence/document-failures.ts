import { IdempotencyKeyBusyError, IdempotencyKeyReusedError } from '@pospay/db';
import { DocumentError } from '../domain/document-types.ts';

function databaseCode(error: unknown): string | null {
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  return typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : null;
}

export function documentFailure(error: unknown, operation: string): Error {
  if (
    error instanceof DocumentError ||
    error instanceof IdempotencyKeyBusyError ||
    error instanceof IdempotencyKeyReusedError
  )
    return error;
  const code = databaseCode(error);
  if (code !== null && ['40001', '40P01', '55P03'].includes(code))
    return new DocumentError('TRANSACTION_RETRY_REQUIRED');
  // تسجيل نفس الملف مرتين يصطدم بالمفتاح الفريد حتى لو فاته الفحص المسبق.
  if (code === '23505' && operation === 'record-employee-document')
    return new DocumentError('DOCUMENT_FILE_ALREADY_RECORDED');
  return new Error('DOCUMENT_PERSISTENCE_FAILED', { cause: error });
}
