import {
  recordSessionTipsInput,
  type RecordSessionTipsInput,
  type SessionTipEntry,
  type SessionTips,
} from '@pospay/contracts';
import {
  moneyToString,
  parseMoney,
  sumTipTotalsByMethod,
  type Money,
} from '@pospay/domain';
import { normalizeKwdInput } from '@pospay/i18n';
import type { FieldErrors, Resolver } from 'react-hook-form';
import {
  byEmployeeId,
  suggestedTipSplit,
  tipPeople,
  visitNetMills,
  type TipSourceLine,
} from './session-tip-source';

const EDGE = /^[\t\r\n ]+|[\t\r\n ]+$/g;

export type TipAmountRow = { employee_id: string; cash: string; card: string };
export type SessionTipFormInput = {
  total: string;
  suggestion_method: 'CASH' | 'CARD';
  rows: TipAmountRow[];
  reason: string;
  expected_revision: number;
  recorder_membership_id: string;
};

export function tipReason(value: string): string {
  return value.replace(EDGE, '');
}

export function tipReasonLength(value: string): number {
  return Array.from(tipReason(value)).length;
}

function canonicalAmount(text: string): string | null | 'invalid' {
  if (text.trim() === '') return null;
  const normalized = normalizeKwdInput(text.trim());
  try {
    const mills = parseMoney(normalized);
    if (mills === 0n) return null;
    if (mills < 0n) return 'invalid';
    // العقد يشترط ثلاث خانات. النص المكتوب «1.5» يتحول من الفلس مش من شكل الإدخال.
    return moneyToString(mills);
  } catch {
    return 'invalid';
  }
}

export function tipEntries(rows: readonly TipAmountRow[]): SessionTipEntry[] | null {
  const tips: SessionTipEntry[] = [];
  for (const row of rows) {
    const cash = canonicalAmount(row.cash);
    const card = canonicalAmount(row.card);
    if (cash === 'invalid' || card === 'invalid') return null;
    const employee_id = row.employee_id.toLowerCase();
    if (cash) tips.push({ employee_id, method: 'CASH', amount: cash });
    if (card) tips.push({ employee_id, method: 'CARD', amount: card });
  }
  return tips.sort((left, right) => {
    const byId = byEmployeeId(left.employee_id, right.employee_id);
    if (byId !== 0) return byId;
    if (left.method === right.method) return 0;
    return left.method === 'CASH' ? -1 : 1;
  });
}

function counted(
  rows: readonly TipAmountRow[],
): { method: 'CASH' | 'CARD'; amount: Money }[] | null {
  const entries = tipEntries(rows);
  if (!entries) return null;
  return entries.map((entry) => ({ method: entry.method, amount: parseMoney(entry.amount) }));
}

function withinMoney<T>(compute: () => T): T | 'too-large' {
  try {
    return compute();
  } catch (error) {
    if (error instanceof RangeError) return 'too-large';
    throw error;
  }
}

function addedTipMills(
  entries: { method: 'CASH' | 'CARD'; amount: Money }[],
): bigint | 'too-large' {
  const totals = withinMoney(() => sumTipTotalsByMethod(entries));
  if (totals === 'too-large') return 'too-large';
  // السقف على كل طريقة لوحدها. جمع النقد والبطاقة مقارنة تحذير فقط، من غير سقف المال.
  return parseMoney(totals.total_cash) + parseMoney(totals.total_card);
}

export type TipMethodTotalsResult =
  | { status: 'invalid' }
  | { status: 'too-large' }
  | { status: 'ok'; total_cash: string; total_card: string };

export function tipMethodTotals(rows: readonly TipAmountRow[]): TipMethodTotalsResult {
  const entries = counted(rows);
  if (!entries) return { status: 'invalid' };
  const totals = withinMoney(() => sumTipTotalsByMethod(entries));
  if (totals === 'too-large') return { status: 'too-large' };
  return { status: 'ok', total_cash: totals.total_cash, total_card: totals.total_card };
}

export type VisitTipSize = 'invalid' | 'within' | 'exceeds' | 'too-large';

export function tipExceedsVisit(
  rows: readonly TipAmountRow[],
  lines: readonly TipSourceLine[],
): VisitTipSize {
  const entries = counted(rows);
  if (!entries) return 'invalid';
  if (entries.length === 0) return 'within';
  const tip = addedTipMills(entries);
  if (tip === 'too-large') return 'too-large';
  const net = withinMoney(() => visitNetMills(lines));
  if (net === 'too-large') return 'too-large';
  return tip > net ? 'exceeds' : 'within';
}

export type SuggestionMillsResult =
  { status: 'none' } | { status: 'too-large' } | { status: 'ok'; mills: bigint };

export function suggestionMills(
  totalText: string,
  rows: readonly TipAmountRow[],
): SuggestionMillsResult {
  if (tipMethodTotals(rows).status === 'too-large') return { status: 'too-large' };
  const typed = canonicalAmount(totalText);
  if (typed === 'invalid') return { status: 'none' };
  if (typed) return { status: 'ok', mills: parseMoney(typed) };
  const entries = counted(rows);
  if (!entries || entries.length === 0) return { status: 'none' };
  const mills = addedTipMills(entries);
  if (mills === 'too-large') return { status: 'too-large' };
  return { status: 'ok', mills };
}

type SuggestionPreview =
  | { status: 'too-large' }
  | { status: 'ready'; rows: NonNullable<ReturnType<typeof suggestedTipSplit>> };

export function previewSuggestion(
  totalText: string,
  rows: readonly TipAmountRow[],
  lines: readonly TipSourceLine[],
): SuggestionPreview {
  const tip = suggestionMills(totalText, rows);
  if (tip.status === 'too-large') return { status: 'too-large' };
  if (tip.status === 'none' || tip.mills <= 0n) return { status: 'ready', rows: [] };
  return { status: 'ready', rows: suggestedTipSplit(tip.mills, lines) ?? [] };
}

function rowsFrom(
  people: { employee_id: string }[],
  tips: readonly SessionTipEntry[],
): TipAmountRow[] {
  const cash = new Map<string, string>();
  const card = new Map<string, string>();
  for (const tip of tips) {
    const bucket = tip.method === 'CASH' ? cash : card;
    bucket.set(tip.employee_id.toLowerCase(), tip.amount);
  }
  return people.map((person) => ({
    employee_id: person.employee_id,
    cash: cash.get(person.employee_id) ?? '',
    card: card.get(person.employee_id) ?? '',
  }));
}

export function tipFormValues(
  tips: SessionTips,
  lines: readonly TipSourceLine[],
  recorderMembershipId = '',
): SessionTipFormInput {
  return {
    total: '',
    suggestion_method: 'CASH',
    rows: rowsFrom(tipPeople(lines, tips.tips), tips.tips),
    reason: '',
    expected_revision: tips.revision,
    recorder_membership_id: recorderMembershipId,
  };
}

function employeesIn(tips: readonly SessionTipEntry[]): { employee_id: string }[] {
  const ids = new Set<string>();
  for (const tip of tips) ids.add(tip.employee_id.toLowerCase());
  return [...ids].sort(byEmployeeId).map((employee_id) => ({ employee_id }));
}

export function tipFormFromBody(body: RecordSessionTipsInput): SessionTipFormInput {
  return {
    total: '',
    suggestion_method: 'CASH',
    // الجسم المحجوز بيتفتح كما أُرسل. منفّذة وصلت بعد الحفظ لو اتضافت هنا بتغيّر المجموعة عن المحاولة اللي لسه مستنّين نتيجتها.
    rows: rowsFrom(employeesIn(body.tips), body.tips),
    reason: body.reason ?? '',
    expected_revision: body.expected_revision,
    recorder_membership_id: body.recorder_membership_id ?? '',
  };
}

function amountOn(method: 'CASH' | 'CARD', text: string, row: TipAmountRow): TipAmountRow {
  if (method === 'CARD') return { ...row, cash: '', card: text };
  return { ...row, cash: text, card: '' };
}

export function rowsUsingSuggestion(
  rows: readonly TipAmountRow[],
  suggestions: readonly { employee_id: string; amount: bigint }[],
  method: 'CASH' | 'CARD',
  exact = false,
): TipAmountRow[] {
  // جسم محاولة معلّقة بيتبعت كما هو؛ توسيعه بيغيّر المفتاح اللي لسه مستنّين نتيجته.
  if (exact) return rows.map((row) => ({ ...row }));
  const amounts = new Map(
    suggestions.map((row) => [row.employee_id.toLowerCase(), moneyToString(row.amount)]),
  );
  const seen = new Set<string>();
  const next = rows.map((row) => {
    const employeeId = row.employee_id.toLowerCase();
    seen.add(employeeId);
    return amountOn(method, amounts.get(employeeId) ?? '', row);
  });
  // منفّذة اتضافت للزيارة بعد فتح الحوار مش في صفوف الفورم، والاقتراح لازم يضيفها عشان المجموع مينقصش.
  for (const row of suggestions) {
    const employeeId = row.employee_id.toLowerCase();
    if (seen.has(employeeId)) continue;
    seen.add(employeeId);
    next.push(
      amountOn(method, moneyToString(row.amount), {
        employee_id: employeeId,
        cash: '',
        card: '',
      }),
    );
  }
  return next;
}

function reasonProblem(value: SessionTipFormInput): boolean {
  const length = tipReasonLength(value.reason);
  if (value.expected_revision > 0) return length < 1 || length > 500;
  return length > 500;
}

export function recordTipsBody(value: SessionTipFormInput): RecordSessionTipsInput | null {
  const tips = tipEntries(value.rows);
  if (!tips || reasonProblem(value) || tipMethodTotals(value.rows).status === 'too-large') {
    return null;
  }
  const reason = tipReason(value.reason);
  const parsed = recordSessionTipsInput.safeParse({
    expected_revision: value.expected_revision,
    tips,
    ...(reason.length > 0 ? { reason } : {}),
    ...(value.recorder_membership_id
      ? { recorder_membership_id: value.recorder_membership_id }
      : {}),
  });
  return parsed.success ? parsed.data : null;
}

function issue(message: string) {
  return { type: 'custom' as const, message };
}

export const resolveSessionTips: Resolver<SessionTipFormInput, unknown, RecordSessionTipsInput> = (
  value,
) => {
  const errors: FieldErrors<SessionTipFormInput> = {};
  if (reasonProblem(value)) errors.reason = issue('reason');
  const totals = tipMethodTotals(value.rows);
  if (totals.status === 'too-large') errors.root = issue('too-large');
  else if (totals.status === 'invalid') errors.root = issue('amount');
  const body = recordTipsBody(value);
  // فشل العقد من غير خطأ ظاهر بيعدّي كنجاح في react-hook-form ويبعّت جسم فاضي.
  if (!body && !errors.reason && !errors.root) errors.root = issue('rejected');
  if (!body || errors.reason || errors.root) return { values: {}, errors };
  return { values: body, errors: {} };
};
