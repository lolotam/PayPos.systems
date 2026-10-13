import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

export const searchHash = (normalizedQ: string) => createHash('sha256').update(normalizedQ).digest('hex');
export const cursorScope = (companyId: string, businessId: string, branchId: string) =>
  searchHash(JSON.stringify([companyId.toLowerCase(), businessId.toLowerCase(), branchId.toLowerCase()]));
export const encodeCursor = (payload: object) => Buffer.from(JSON.stringify(payload)).toString('base64url');
export function decodeCursor<T extends object>(encoded: string, parse: (value: unknown) => T): T {
  const cursor = parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
  if (encodeCursor(cursor) !== encoded) throw new RangeError();
  return cursor;
}
