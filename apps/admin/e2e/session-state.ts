import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { civilDate } from './civil-date';
import { joinCookies } from './http-cookie';

export interface DayPerformer {
  readonly employee_id: string;
  readonly share_bps: number;
  readonly not_clocked_in_warning: boolean;
  readonly approved_leave_warning: boolean;
}

export interface DayLine {
  readonly id: string;
  readonly service_id: string;
  readonly price: string;
  readonly list_price: string;
  readonly discount: string;
  readonly net: string;
  readonly late: boolean;
  readonly performers: readonly DayPerformer[];
}

export interface DayVisit {
  readonly id: string;
  readonly occurred_at: string;
  readonly late: boolean;
  readonly customer: { readonly name: string };
  readonly lines: readonly DayLine[];
}

export interface E2eState {
  readonly apiBase: string;
  readonly origin: string;
  readonly ownerEmail: string;
  readonly ownerPassword: string;
  readonly recorderEmail: string;
  readonly recorderPassword: string;
  readonly recorderTotpSecret: string;
  readonly otherEmail: string;
  readonly otherPassword: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly branchName: string;
  readonly recorderMembershipId: string;
  readonly narrowMembershipId: string;
  readonly standardServiceId: string;
  readonly standardServiceName: string;
  readonly oddServiceId: string;
  readonly oddServiceName: string;
  readonly employees: readonly { readonly id: string; readonly name: string }[];
  readonly otherCompanyId: string;
  readonly otherCompanyName: string;
  readonly otherBusinessId: string;
  readonly otherBranchId: string;
  readonly otherBranchName: string;
}

const stateFile = join(import.meta.dirname, '.state/session.env');
const cookies = new Map<string, Promise<string>>();
let sequence = 0;

function requireKey(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (value === undefined || value === '') throw new Error(`e2e state missing ${key}`);
  return value;
}

export function loadState(): E2eState {
  const values = new Map<string, string>();
  for (const line of readFileSync(stateFile, 'utf8').split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const split = line.indexOf('=');
    if (split > 0) values.set(line.slice(0, split), line.slice(split + 1));
  }
  const employees = [1, 2, 3, 4].map((index) => ({
    id: requireKey(values, `EMPLOYEE_${index}_ID`),
    name: requireKey(values, `EMPLOYEE_${index}_NAME`),
  }));
  return {
    apiBase: requireKey(values, 'API_BASE'),
    origin: requireKey(values, 'ORIGIN'),
    ownerEmail: requireKey(values, 'OWNER_EMAIL'),
    ownerPassword: requireKey(values, 'OWNER_PASSWORD'),
    recorderEmail: requireKey(values, 'RECORDER_EMAIL'),
    recorderPassword: requireKey(values, 'RECORDER_PASSWORD'),
    recorderTotpSecret: requireKey(values, 'RECORDER_TOTP_SECRET'),
    otherEmail: requireKey(values, 'OTHER_EMAIL'),
    otherPassword: requireKey(values, 'OTHER_PASSWORD'),
    companyId: requireKey(values, 'COMPANY_ID'),
    companyName: requireKey(values, 'COMPANY_NAME'),
    businessId: requireKey(values, 'BUSINESS_ID'),
    branchId: requireKey(values, 'BRANCH_ID'),
    branchName: requireKey(values, 'BRANCH_NAME'),
    recorderMembershipId: requireKey(values, 'RECORDER_MEMBERSHIP_ID'),
    narrowMembershipId: requireKey(values, 'NARROW_MEMBERSHIP_ID'),
    standardServiceId: requireKey(values, 'STANDARD_SERVICE_ID'),
    standardServiceName: requireKey(values, 'STANDARD_SERVICE_NAME'),
    oddServiceId: requireKey(values, 'ODD_SERVICE_ID'),
    oddServiceName: requireKey(values, 'ODD_SERVICE_NAME'),
    employees,
    otherCompanyId: requireKey(values, 'OTHER_COMPANY_ID'),
    otherCompanyName: requireKey(values, 'OTHER_COMPANY_NAME'),
    otherBusinessId: requireKey(values, 'OTHER_BUSINESS_ID'),
    otherBranchId: requireKey(values, 'OTHER_BRANCH_ID'),
    otherBranchName: requireKey(values, 'OTHER_BRANCH_NAME'),
  };
}

export function nationalNumber(): string {
  sequence += 1;
  return String(10_000_000 + ((Date.now() + sequence) % 90_000_000));
}

export function label(prefix: string): string {
  sequence += 1;
  return `${prefix} ${Date.now().toString(36)}-${sequence}`;
}

export function performerAt(state: E2eState, index: number): { readonly id: string; readonly name: string } {
  const person = state.employees[index];
  if (person === undefined) throw new Error('e2e performer missing');
  return person;
}

export { civilDate };

interface DayPage {
  readonly items: DayVisit[];
  readonly next_cursor: string | null;
}

async function signInApi(state: E2eState, email: string, password: string): Promise<string> {
  const response = await fetch(`${state.apiBase}/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: state.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`e2e API sign-in ${response.status}`);
  const cookie = joinCookies(response.headers);
  if (cookie === '') throw new Error('e2e API sign-in cookie missing');
  return cookie;
}

export function apiCookie(state: E2eState, who: 'owner' | 'other'): Promise<string> {
  const email = who === 'owner' ? state.ownerEmail : state.otherEmail;
  const password = who === 'owner' ? state.ownerPassword : state.otherPassword;
  const cached = cookies.get(email);
  if (cached !== undefined) return cached;
  const pending = signInApi(state, email, password);
  cookies.set(email, pending);
  // فشل عابر ما يتخزنش: الطلب اللي بعده يحاول يدخل تاني بدل ما كل الاختبارات الباقية تقع بنفس الخطأ.
  pending.catch(() => { cookies.delete(email); });
  return pending;
}

function dayUrl(state: E2eState, who: 'owner' | 'other', date: string, cursor: string | null): string {
  const businessId = who === 'owner' ? state.businessId : state.otherBusinessId;
  const branchId = who === 'owner' ? state.branchId : state.otherBranchId;
  const url = new URL(`${state.apiBase}/v1/businesses/${businessId}/branches/${branchId}/service-sessions`);
  url.searchParams.set('date', date);
  if (cursor !== null) url.searchParams.set('cursor', cursor);
  return url.toString();
}

export async function dayVisits(state: E2eState, who: 'owner' | 'other', date: string): Promise<DayVisit[]> {
  const companyId = who === 'owner' ? state.companyId : state.otherCompanyId;
  const items: DayVisit[] = [];
  let cursor: string | null = null;
  do {
    const response = await fetch(dayUrl(state, who, date, cursor), {
      headers: { cookie: await apiCookie(state, who), 'x-company-id': companyId },
    });
    if (!response.ok) throw new Error(`day list ${response.status}`);
    const body = (await response.json()) as DayPage;
    items.push(...body.items);
    cursor = typeof body.next_cursor === 'string' && body.next_cursor !== '' ? body.next_cursor : null;
  } while (cursor !== null);
  return items;
}

export async function savedVisit(state: E2eState, customer: string, date: string): Promise<DayVisit> {
  const found = (await dayVisits(state, 'owner', date)).filter((item) => item.customer.name === customer);
  if (found.length !== 1) throw new Error(`visit count ${found.length}`);
  const visit = found[0];
  if (visit === undefined) throw new Error('visit count 0');
  return visit;
}
