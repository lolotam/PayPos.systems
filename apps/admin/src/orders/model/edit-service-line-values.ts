import { discountPercentage, editServiceLineInput, id as uuid, sessionMoney, type EditServiceLineInput } from '@pospay/contracts';
import { discountFromPercent, lineNet, parseMoney } from '@pospay/domain';
import { formatKwd, normalizeKwdInput, type Locale } from '@pospay/i18n';
import type { FieldErrors, Resolver } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { editAccessRevoked } from './service-session-access';
import { normalizeSessionPercent } from './session-drafts';

const EDGE = /^[\t\r\n ]+|[\t\r\n ]+$/g;
export type EditLineFormInput = {
  price: string; discount_kind: 'AMOUNT' | 'PERCENT'; discount_value: string;
  reason: string; expected_revision: number; editor_membership_id: string;
};
export type EditLimitDetails = {
  effective_discount_bps: number; limit_bps_applied: number; minimum_net: string; max_discount_amount: string;
};

export function editReason(value: string): string {
  return value.replace(EDGE, '');
}
export function editReasonLength(value: string): number {
  return Array.from(editReason(value)).length;
}

function discountOf(kind: EditLineFormInput['discount_kind'], text: string): EditServiceLineInput['discount'] | null {
  if (kind === 'AMOUNT') {
    const amount = sessionMoney.safeParse(normalizeKwdInput(text));
    return amount.success ? { kind: 'AMOUNT', amount: amount.data } : null;
  }
  const bps = discountPercentage.safeParse(normalizeSessionPercent(text));
  return bps.success ? { kind: 'PERCENT', bps: bps.data } : null;
}

function fitsPrice(price: string, discount: NonNullable<ReturnType<typeof discountOf>>): boolean {
  try {
    const priceMoney = parseMoney(price);
    const discountMoney = discount.kind === 'AMOUNT' ? parseMoney(discount.amount) : discountFromPercent(priceMoney, discount.bps);
    lineNet(priceMoney, discountMoney);
    return true;
  } catch {
    return false;
  }
}

export function editLineBody(value: EditLineFormInput): EditServiceLineInput | null {
  const price = sessionMoney.safeParse(normalizeKwdInput(value.price));
  const reason = editReason(value.reason);
  const length = Array.from(reason).length;
  const discount = discountOf(value.discount_kind, value.discount_value);
  if (!price.success || !discount || length < 1 || length > 500 || !fitsPrice(price.data, discount)) return null;
  const parsed = editServiceLineInput.safeParse({
    price: price.data, discount, reason, expected_revision: value.expected_revision,
    ...(value.editor_membership_id ? { editor_membership_id: value.editor_membership_id } : {}),
  });
  return parsed.success ? parsed.data : null;
}

function issue(message: string) {
  return { type: 'custom' as const, message };
}

// السبب بيتقص أطرافه ويتعد بالحروف. لو الجسم سقط والعقد الشكلي عدّى، الخطأ على الخصم عشان الأخطاء الفاضية بتعدي كإرسال.
export const resolveEditLine: Resolver<EditLineFormInput, unknown, EditServiceLineInput> = (value) => {
  const errors: FieldErrors<EditLineFormInput> = {};
  const length = editReasonLength(value.reason);
  if (length < 1 || length > 500) errors.reason = issue('reason');
  if (!sessionMoney.safeParse(normalizeKwdInput(value.price)).success) errors.price = issue('price');
  if (!discountOf(value.discount_kind, value.discount_value)) errors.discount_value = issue('discount');
  const body = editLineBody(value);
  if (!body && !errors.reason && !errors.price && !errors.discount_value) errors.discount_value = issue('discount');
  if (!body || errors.reason || errors.price || errors.discount_value) return { values: {}, errors };
  return { values: body, errors: {} };
};

export function previewLineEdit(priceText: string, kind: EditLineFormInput['discount_kind'], valueText: string) {
  const price = sessionMoney.safeParse(normalizeKwdInput(priceText));
  const discount = discountOf(kind, valueText);
  if (!price.success || !discount) return null;
  try {
    const priceMoney = parseMoney(price.data);
    const discountMoney = discount.kind === 'PERCENT' ? discountFromPercent(priceMoney, discount.bps) : parseMoney(discount.amount);
    return { discount: formatKwd(discountMoney), net: formatKwd(lineNet(priceMoney, discountMoney)) };
  } catch {
    return null;
  }
}

type EditFailure =
  | { kind: 'stale' | 'forbidden' | 'revoked' | 'root'; message: string }
  | { kind: 'field'; field: 'reason' | 'discount_value'; message: string }
  | { kind: 'limit'; message: string; details: EditLimitDetails }
  | { kind: 'membership'; message: string; ids: string[] };

function refusal(error: unknown) {
  if (!error || typeof error !== 'object') return {};
  const body = error as { status?: unknown; code?: unknown; details?: unknown };
  return { status: typeof body.status === 'number' ? body.status : undefined, code: typeof body.code === 'string' ? body.code : undefined, details: body.details };
}

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function readLimit(details: unknown): EditLimitDetails | null {
  if (!details || typeof details !== 'object') return null;
  const body = details as Record<string, unknown>;
  const effective = whole(body.effective_discount_bps);
  const applied = whole(body.limit_bps_applied);
  const minimum = sessionMoney.safeParse(body.minimum_net);
  const maximum = sessionMoney.safeParse(body.max_discount_amount);
  if (effective === null || applied === null || !minimum.success || !maximum.success) return null;
  return { effective_discount_bps: effective, limit_bps_applied: applied, minimum_net: minimum.data, max_discount_amount: maximum.data };
}

function readMemberships(details: unknown): string[] | null {
  if (!details || typeof details !== 'object') return null;
  const ids = (details as { editor_membership_ids?: unknown }).editor_membership_ids;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const parsed: string[] = [];
  for (const item of ids) {
    const result = uuid.safeParse(item);
    if (!result.success) return null;
    parsed.push(result.data);
  }
  return parsed;
}

export function classifyEditError(error: unknown, locale: Locale): EditFailure {
  const { status, code, details } = refusal(error);
  const message = envelopeMessage(error, locale);
  // 403 العادي بيقفل النموذج والبيانات تفضل ظاهرة؛ 401 أو FEATURE_DISABLED يعني الوصول نفسه اتقفل.
  if (editAccessRevoked(error)) return { kind: 'revoked', message };
  if (status === 403) return { kind: 'forbidden', message };
  if (status === 409 && code === 'SESSION_LINE_REVISION_STALE') return { kind: 'stale', message };
  if (status === 422 && code === 'SESSION_EDIT_NO_CHANGE') return { kind: 'field', field: 'discount_value', message };
  if (status === 422 && code === 'SESSION_EDIT_REASON_INVALID') return { kind: 'field', field: 'reason', message };
  if (status === 422 && code === 'SESSION_DISCOUNT_ABOVE_LIMIT') {
    const parsed = readLimit(details);
    if (parsed) return { kind: 'limit', message, details: parsed };
  }
  if (status === 422 && code === 'SESSION_EDITOR_MEMBERSHIP_REQUIRED') {
    const ids = readMemberships(details);
    if (ids) return { kind: 'membership', message, ids };
  }
  return { kind: 'root', message };
}
