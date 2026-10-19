import {
  recordSessionTipsInput,
  type RecordSessionTipsInput,
  type SessionTipEntry,
  type SessionTips,
} from '@pospay/contracts';
import {
  moneyToString,
  parseMoney,
  sumMoney,
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
    return normalized;
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

export function tipMethodTotals(rows: readonly TipAmountRow[]) {
  const entries = counted(rows);
  if (!entries) return null;
  return sumTipTotalsByMethod(entries);
}

export function tipExceedsVisit(
  rows: readonly TipAmountRow[],
  lines: readonly TipSourceLine[],
): boolean {
  const entries = counted(rows);
  if (!entries || entries.length === 0) return false;
  const totals = sumTipTotalsByMethod(entries);
  const tip = sumMoney([parseMoney(totals.total_cash), parseMoney(totals.total_card)]);
  return tip > visitNetMills(lines);
}

export function suggestionMills(totalText: string, rows: readonly TipAmountRow[]): bigint | null {
  const typed = canonicalAmount(totalText);
  if (typed === 'invalid') return null;
  if (typed) return parseMoney(typed);
  const entries = counted(rows);
  if (!entries || entries.length === 0) return null;
  const totals = sumTipTotalsByMethod(entries);
  return sumMoney([parseMoney(totals.total_cash), parseMoney(totals.total_card)]);
}

export function previewSuggestion(
  totalText: string,
  rows: readonly TipAmountRow[],
  lines: readonly TipSourceLine[],
) {
  const tip = suggestionMills(totalText, rows);
  if (tip === null || tip <= 0n) return [];
  return suggestedTipSplit(tip, lines);
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
): SessionTipFormInput {
  return {
    total: '',
    suggestion_method: 'CASH',
    rows: rowsFrom(tipPeople(lines, tips.tips), tips.tips),
    reason: '',
    expected_revision: tips.revision,
    recorder_membership_id: '',
  };
}

export function rowsUsingSuggestion(
  rows: readonly TipAmountRow[],
  suggestions: readonly { employee_id: string; amount: bigint }[],
  method: 'CASH' | 'CARD',
): TipAmountRow[] {
  const amounts = new Map(
    suggestions.map((row) => [row.employee_id.toLowerCase(), moneyToString(row.amount)]),
  );
  return rows.map((row) => {
    const text = amounts.get(row.employee_id.toLowerCase()) ?? '';
    if (method === 'CARD') return { ...row, cash: '', card: text };
    return { ...row, cash: text, card: '' };
  });
}

function reasonProblem(value: SessionTipFormInput): boolean {
  const length = tipReasonLength(value.reason);
  if (value.expected_revision > 0) return length < 1 || length > 500;
  return length > 500;
}

export function recordTipsBody(value: SessionTipFormInput): RecordSessionTipsInput | null {
  const tips = tipEntries(value.rows);
  if (!tips || reasonProblem(value)) return null;
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
  if (!tipEntries(value.rows)) errors.root = issue('amount');
  const body = recordTipsBody(value);
  if (!body || errors.reason || errors.root) return { values: {}, errors };
  return { values: body, errors: {} };
};
