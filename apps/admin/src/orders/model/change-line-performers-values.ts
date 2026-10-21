import {
  changeLinePerformersInput,
  id as uuid,
  type ChangeLinePerformersInput,
  type ServiceSessionDayPage,
} from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';
import { envelopeMessage } from '@/shared/api/api-error';
import { cancelReason, cancelReasonLength } from './cancel-service-line-values';
import { editAccessRevoked } from './service-session-access';
import { sessionBpsText } from './session-recording-result';
import { sessionPerformerInputs, type SessionDraftLine } from './session-drafts';

type DayLine = ServiceSessionDayPage['items'][number]['lines'][number];
export type PerformersFormInput = {
  lines: [SessionDraftLine];
  reason: string;
  expected_revision: number;
  changer_membership_id: string;
};
type PerformersFailure =
  | { kind: 'stale'; message: string }
  | { kind: 'forbidden' | 'revoked' | 'root'; message: string }
  | { kind: 'field'; message: string }
  | { kind: 'membership'; message: string; ids: string[] };

export const performersReasonLength = cancelReasonLength;

export function performersReasonValid(value: string): boolean {
  const length = performersReasonLength(value);
  return length >= 1 && length <= 500;
}

// سطر 70/30 لو فتح على «بالتساوي» كان تبديل منفّذة واحدة هيحرّك عمولة الباقيين من غير ما حد يقرر؛
// فالنسب المحفوظة بتفضل مكتوبة إلا لو كلها متساوية بالظبط.
function sharedEqually(line: DayLine): boolean {
  const first = line.performers[0]?.share_bps;
  return line.performers.every((row) => row.share_bps === first);
}

export function performersSeed(line: DayLine): SessionDraftLine {
  const equal = sharedEqually(line);
  return {
    local_id: `performers-${line.id}`,
    service_id: line.service_id,
    price: line.price,
    service: null,
    discount_kind: 'AMOUNT',
    discount_amount: line.discount,
    discount_percentage: '0',
    share_mode: equal ? 'EQUAL' : 'CUSTOM',
    performers: line.performers.map((row) => ({
      employee_id: row.employee_id,
      share_percentage: equal ? '' : sessionBpsText(row.share_bps),
      selection: null,
    })),
  };
}

export function performersBody(value: PerformersFormInput): ChangeLinePerformersInput | null {
  if (!performersReasonValid(value.reason)) return null;
  let performers: ChangeLinePerformersInput['performers'];
  try {
    performers = sessionPerformerInputs(value.lines[0]);
  } catch {
    return null;
  }
  const parsed = changeLinePerformersInput.safeParse({
    performers,
    reason: cancelReason(value.reason),
    expected_revision: value.expected_revision,
    ...(value.changer_membership_id ? { changer_membership_id: value.changer_membership_id } : {}),
  });
  return parsed.success ? parsed.data : null;
}

function refusal(error: unknown) {
  if (!error || typeof error !== 'object') return {};
  const body = error as { status?: unknown; code?: unknown; details?: unknown };
  return {
    status: typeof body.status === 'number' ? body.status : undefined,
    code: typeof body.code === 'string' ? body.code : undefined,
    details: body.details,
  };
}

function readMemberships(details: unknown): string[] | null {
  if (!details || typeof details !== 'object') return null;
  const ids = (details as { changer_membership_ids?: unknown }).changer_membership_ids;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const parsed: string[] = [];
  for (const item of ids) {
    const result = uuid.safeParse(item);
    if (!result.success) return null;
    parsed.push(result.data);
  }
  return parsed;
}

export function classifyPerformersError(error: unknown, locale: Locale): PerformersFailure {
  const { status, code, details } = refusal(error);
  const message = envelopeMessage(error, locale);
  if (editAccessRevoked(error)) return { kind: 'revoked', message };
  if (status === 403) return { kind: 'forbidden', message };
  if (status === 409 && code === 'SESSION_LINE_REVISION_STALE') return { kind: 'stale', message };
  if (status === 422 && code === 'SESSION_PERFORMERS_REASON_INVALID')
    return { kind: 'field', message };
  if (status === 422 && code === 'SESSION_CHANGER_MEMBERSHIP_REQUIRED') {
    const ids = readMemberships(details);
    if (ids) return { kind: 'membership', message, ids };
  }
  return { kind: 'root', message };
}

// 409 من غير تعارض مراجعة معناه إن الطلب الأول لسه شغّال؛ نتيجته مجهولة فالمفتاح يفضل محجوز.
export function performersOutcomeKnown(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if (editAccessRevoked(error)) return true;
  const status = (error as { status?: unknown }).status;
  const code = (error as { code?: unknown }).code;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status > 499)
    return false;
  if (status === 409) return code === 'SESSION_LINE_REVISION_STALE';
  return true;
}
