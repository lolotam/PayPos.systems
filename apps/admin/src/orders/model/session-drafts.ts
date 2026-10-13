import { discountPercentage, type RecordServiceSessionInput, type SessionServiceOptionPage, type SessionPerformerOptionPage } from '@pospay/contracts';
import { moneyToString, parseMoney } from '@pospay/domain';

export type SessionServiceSelection = SessionServiceOptionPage['items'][number];
export type SessionPerformerSelection = SessionPerformerOptionPage['items'][number];
export const sessionSharePercentage = discountPercentage.refine((bps) => bps > 0);
export type SessionDraftLine = Pick<RecordServiceSessionInput['lines'][number], 'service_id' | 'price'> & {
  local_id: string;
  service: SessionServiceSelection | null;
  discount_kind: RecordServiceSessionInput['lines'][number]['discount']['kind'];
  discount_amount: string;
  discount_percentage: string;
  share_mode: 'EQUAL' | 'CUSTOM';
  performers: { employee_id: string; share_percentage: string; selection: SessionPerformerSelection | null; facts_key?: string }[];
};
export type SessionDraftForm = Pick<RecordServiceSessionInput, 'occurred_at'> & { lines: SessionDraftLine[]; recorder_membership_id?: string | null };
export const SESSION_DRAFT_MIN = 1, SESSION_DRAFT_MAX = 20;

export function createSessionDraft(localId: string = crypto.randomUUID()): SessionDraftLine {
  return { local_id: localId, service_id: '', price: '', service: null,
    discount_kind: 'AMOUNT', discount_amount: '0.000', discount_percentage: '0', share_mode: 'EQUAL',
    performers: [{ employee_id: '', share_percentage: '', selection: null }] };
}

export function sessionPerformerInputs(line: SessionDraftLine): RecordServiceSessionInput['lines'][number]['performers'] {
  return line.performers.map((row) => ({ employee_id: row.employee_id,
    ...(line.share_mode === 'CUSTOM' ? { share_bps: sessionSharePercentage.parse(normalizeSessionPercent(row.share_percentage)) } : {}) }));
}

export function selectSessionService(line: SessionDraftLine, service: SessionServiceSelection): SessionDraftLine {
  // إعادة اختيار نفس الخدمة أو تحديث الكتالوج لا يمسح السعر اللي كتبته الريسبشن.
  if (line.service_id === service.id) return line;
  return { ...line, service_id: service.id, service, price: moneyToString(parseMoney(service.price)) };
}

export function normalizeSessionPercent(text: string): string {
  return text.replace(/[\u0660-\u0669]/g, (digit) => '0123456789'.charAt(String.fromCharCode(0x660, 0x661, 0x662, 0x663, 0x664, 0x665, 0x666, 0x667, 0x668, 0x669).indexOf(digit)))
    .replace(/[\u06f0-\u06f9]/g, (digit) => '0123456789'.charAt(String.fromCharCode(0x6f0, 0x6f1, 0x6f2, 0x6f3, 0x6f4, 0x6f5, 0x6f6, 0x6f7, 0x6f8, 0x6f9).indexOf(digit))).replace(/\u066b/g, '.');
}
