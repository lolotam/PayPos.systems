import type { RecordServiceSessionInput, SessionServiceOptionPage } from '@pospay/contracts';
import { moneyToString, parseMoney } from '@pospay/domain';

export type SessionServiceSelection = SessionServiceOptionPage['items'][number];
export type SessionDraftLine = Pick<RecordServiceSessionInput['lines'][number], 'service_id' | 'price'> & {
  local_id: string;
  service: SessionServiceSelection | null;
};
export type SessionDraftForm = { lines: SessionDraftLine[] };
export const SESSION_DRAFT_MIN = 1, SESSION_DRAFT_MAX = 20;

export function createSessionDraft(localId: string = crypto.randomUUID()): SessionDraftLine {
  return { local_id: localId, service_id: '', price: '', service: null };
}

export function selectSessionService(line: SessionDraftLine, service: SessionServiceSelection): SessionDraftLine {
  // إعادة اختيار نفس الخدمة أو تحديث الكتالوج لا يمسح السعر اللي كتبته الريسبشن.
  if (line.service_id === service.id) return line;
  return { ...line, service_id: service.id, service, price: moneyToString(parseMoney(service.price)) };
}
