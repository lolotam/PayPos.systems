import {
  WhatsappQueueUnavailableError,
  WhatsappDigestUnavailableError,
} from '@pospay/notifications';

const PG_CODES = new Set([
  '55P03',
  '57014',
  '40001',
  '40P01',
  '42501',
  '23502',
  '23503',
  '23505',
  '23514',
  '08000',
  '08003',
  '08006',
  '57P01',
]);
const CLASSES = new Set([
  'Error',
  'TypeError',
  'SyntaxError',
  'PostgresError',
  'DrizzleQueryError',
  'TimeoutError',
  'CommitOutcomeUnknownError',
  'WhatsappQueueUnavailableError',
  'WhatsappDigestUnavailableError',
]);

export function whatsappFailure(error: unknown) {
  const errors: Error[] = [];
  let current = error;
  for (let depth = 0; current instanceof Error && depth < 4; depth++) {
    errors.push(current);
    current = current.cause;
  }
  const pg = errors.find((value) => PG_CODES.has(String((value as { code?: unknown }).code)));
  const pgCode = pg === undefined ? undefined : String((pg as { code?: unknown }).code);
  const transient =
    errors.some(
      (value) =>
        value.name === 'TimeoutError' ||
        value.name === 'CommitOutcomeUnknownError' ||
        value instanceof WhatsappQueueUnavailableError ||
        value instanceof WhatsappDigestUnavailableError,
    ) ||
    pgCode === '55P03' ||
    pgCode === '57014';
  const name = errors[0]?.name;
  return {
    transient,
    diagnostic: {
      type: name !== undefined && CLASSES.has(name) ? name : 'Error',
      ...(pgCode === undefined ? {} : { pgCode }),
    },
  };
}
