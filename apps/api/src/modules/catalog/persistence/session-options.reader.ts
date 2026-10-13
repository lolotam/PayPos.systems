import { sessionServiceCursorData, type SessionServiceOptionsQuery } from '@pospay/contracts';
import { cursorScope, searchHash, encodeCursor, decodeCursor } from '../../../shared/persistence/name-options-cursor.ts';

export const sessionServiceCursorCodec = {
  scope: cursorScope,
  decode(query: SessionServiceOptionsQuery, normalizedQ: string, scopeHash: string) {
    if (query.cursor === undefined) return null;
    try {
      const cursor = decodeCursor(query.cursor, (value) => sessionServiceCursorData.parse(value));
      if (cursor.lang !== query.lang || cursor.q_hash !== searchHash(normalizedQ) || cursor.scope_hash !== scopeHash) throw new Error();
      return cursor;
    } catch { throw new RangeError('SESSION_SERVICE_CURSOR_INVALID'); }
  },
  encode(key: string, id: string, query: SessionServiceOptionsQuery, normalizedQ: string, scopeHash: string) {
    return encodeCursor({ key, id, lang: query.lang, q_hash: searchHash(normalizedQ), scope_hash: scopeHash });
  },
};
