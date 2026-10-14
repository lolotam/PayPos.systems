import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { t, type Locale } from '@pospay/i18n';

import { freshTotp } from './totp';

function byLabel(root: Page | Locator, name: string): Locator {
  return root.getByLabel(name, { exact: true });
}

export interface DayPerformer {
  readonly employee_id: string;
  readonly share_bps: number;
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

export interface LineSpec {
  readonly serviceName: string;
  readonly catalogPrice: string;
  readonly price?: string;
  readonly discount: { readonly kind: 'AMOUNT' | 'PERCENT'; readonly value: string };
  readonly performers: readonly string[];
  readonly shares?: readonly string[];
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

const stateFile = join(dirname(fileURLToPath(import.meta.url)), '.state/session.env');
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

export function kuwaitDate(offsetDays: number): string {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuwait',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month, day] = formatted.split('-').map(Number);
  const utc = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + offsetDays));
  return utc.toISOString().slice(0, 10);
}

export async function documentLocale(page: Page): Promise<Locale> {
  return (await page.locator('html').getAttribute('lang')) === 'en' ? 'en' : 'ar';
}

export async function useLocale(page: Page, target: Locale): Promise<void> {
  const current = await documentLocale(page);
  if (current === target) return;
  const labelKey = target === 'ar' ? 'admin.languageArabic' : 'admin.languageEnglish';
  await page.getByRole('button', { name: t(current, labelKey) }).click();
  await page.waitForFunction((lang) => document.documentElement.lang === lang, target);
}

export async function signInThroughUi(
  page: Page,
  email: string,
  password: string,
  totpSecret?: string,
): Promise<void> {
  await page.goto('/login');
  const locale = await documentLocale(page);
  await page.getByLabel(t(locale, 'admin.emailLabel')).fill(email);
  await page.getByLabel(t(locale, 'admin.passwordLabel')).fill(password);
  await page.getByRole('button', { name: t(locale, 'admin.signInSubmit') }).click();
  if (totpSecret !== undefined) {
    await page.waitForURL('**/login/two-factor');
    const codeLocale = await documentLocale(page);
    await page.getByLabel(t(codeLocale, 'admin.codeLabel')).fill(await freshTotp(totpSecret));
    await page.getByRole('button', { name: t(codeLocale, 'admin.verifySubmit') }).click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

export async function chooseCompany(page: Page, companyName: string): Promise<void> {
  const company = page.locator('#workspace-company');
  const locale = await documentLocale(page);
  const open = page.getByRole('button', { name: t(locale, 'shell.openNavigation') });
  // القائمة بتتحمل بعد الدخول؛ تحت 768px هي درج، فبنستنى أي الاتنين يظهر.
  await expect(company.or(open)).toBeVisible();
  if (!(await company.isVisible())) await open.click();
  await company.click();
  await page.getByRole('option', { name: companyName, exact: true }).click();
  const close = page.getByRole('button', { name: t(locale, 'shell.closeNavigation') });
  if (await close.isVisible()) await close.click();
}

export async function openRecorder(page: Page, state: E2eState, locale: Locale): Promise<void> {
  await page.goto('/login');
  await useLocale(page, locale);
  await signInThroughUi(page, state.recorderEmail, state.recorderPassword, state.recorderTotpSecret);
  await page.goto('/orders/service-sessions/new');
  await chooseCompany(page, state.companyName);
  await expect(page.getByRole('heading', { name: t(locale, 'serviceSessions.title') })).toBeVisible();
  await expect(page.getByText(t(locale, 'serviceSessions.limit')).first()).toBeVisible();
}

export async function findOrCreateCustomer(
  page: Page,
  locale: Locale,
  name: string,
  national: string,
): Promise<void> {
  const fieldset = page.getByRole('group', { name: t(locale, 'serviceSessions.customer') });
  await byLabel(fieldset, t(locale, 'serviceSessions.name')).fill(name);
  await byLabel(fieldset, t(locale, 'serviceSessions.callingCode')).fill('965');
  await byLabel(fieldset, t(locale, 'serviceSessions.phone')).fill(national);
  await fieldset.getByRole('button', { name: t(locale, 'serviceSessions.findOrCreate') }).click();
  await expect(fieldset.getByRole('status')).toContainText(t(locale, 'serviceSessions.selected'));
}

async function applyDiscount(
  group: Locator,
  locale: Locale,
  discount: LineSpec['discount'],
): Promise<void> {
  if (discount.kind === 'PERCENT') {
    await group.getByRole('button', { name: t(locale, 'serviceSessions.discountPercent') }).click();
  }
  const key = discount.kind === 'PERCENT' ? 'serviceSessions.discountPercent' : 'serviceSessions.discountAmount';
  const field = byLabel(group, t(locale, key));
  await field.fill(discount.value);
  await field.blur();
}

async function applyPerformers(group: Locator, locale: Locale, spec: LineSpec): Promise<void> {
  if (spec.shares !== undefined) {
    await group.getByRole('button', { name: t(locale, 'serviceSessions.customShares') }).click();
  }
  for (let index = 1; index < spec.performers.length; index += 1) {
    await group.getByRole('button', { name: t(locale, 'serviceSessions.addPerformer') }).click();
  }
  for (const [index, name] of spec.performers.entries()) {
    const performer = byLabel(
      group,
      t(locale, 'serviceSessions.performerNumber').replace('{n}', String(index + 1)),
    );
    await expect(performer).toBeEnabled();
    await performer.selectOption({ label: name });
    const share = spec.shares?.[index];
    if (share === undefined) continue;
    const input = byLabel(group, t(locale, 'serviceSessions.share').replace('{n}', String(index + 1)));
    await input.fill(share);
    await input.blur();
  }
}

export async function fillLine(page: Page, locale: Locale, index: number, spec: LineSpec): Promise<void> {
  const group = page.getByRole('group', {
    name: t(locale, 'serviceSessions.lineNumber').replace('{n}', String(index + 1)),
  });
  const service = byLabel(group, t(locale, 'serviceSessions.service'));
  await expect(service).toBeEnabled();
  await service.selectOption({ label: spec.serviceName });
  const price = byLabel(group, t(locale, 'serviceSessions.price'));
  await expect(price).toHaveValue(spec.catalogPrice);
  if (spec.price !== undefined) {
    await price.fill(spec.price);
    await price.blur();
  }
  await applyDiscount(group, locale, spec.discount);
  await applyPerformers(group, locale, spec);
}

export async function addDraftLine(page: Page, locale: Locale): Promise<void> {
  await page.getByRole('button', { name: t(locale, 'serviceSessions.addLine') }).click();
}

export async function setOccurredAt(page: Page, locale: Locale, local: string): Promise<void> {
  const input = byLabel(page, t(locale, 'serviceSessions.occurredAt'));
  await input.fill(local);
  await input.blur();
}

export function isCreatePost(url: string, method: string): boolean {
  return method === 'POST' && /\/service-sessions$/u.test(new URL(url).pathname);
}

function isSessionPost(url: string, method: string, kind: 'create' | 'append'): boolean {
  if (method !== 'POST') return false;
  const path = new URL(url).pathname;
  const append = /\/service-sessions\/[^/]+\/lines$/u.test(path);
  return kind === 'append' ? append : /\/service-sessions$/u.test(path);
}

export async function submitVisit(
  page: Page,
  locale: Locale,
  kind: 'create' | 'append',
  keyboard = false,
): Promise<Response> {
  const name = t(locale, kind === 'create' ? 'serviceSessions.save' : 'serviceSessions.correctAndAppend');
  const pending = page.waitForResponse(
    (response) => isSessionPost(response.url(), response.request().method(), kind),
    { timeout: 20_000 },
  );
  if (keyboard) await byLabel(page, t(locale, 'serviceSessions.price')).first().press('Enter');
  else await page.getByRole('button', { name }).click();
  return pending;
}

async function signInApi(state: E2eState, email: string, password: string): Promise<string> {
  const response = await fetch(`${state.apiBase}/v1/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: state.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`owner sign-in ${response.status}`);
  const cookie = response.headers
    .getSetCookie()
    .map((item) => item.split(';')[0] ?? '')
    .filter(Boolean)
    .join('; ');
  if (cookie === '') throw new Error('owner sign-in cookie missing');
  return cookie;
}

export function apiCookie(state: E2eState, who: 'owner' | 'other'): Promise<string> {
  const email = who === 'owner' ? state.ownerEmail : state.otherEmail;
  const password = who === 'owner' ? state.ownerPassword : state.otherPassword;
  const cached = cookies.get(email);
  if (cached !== undefined) return cached;
  const pending = signInApi(state, email, password);
  cookies.set(email, pending);
  return pending;
}

export async function dayVisits(state: E2eState, who: 'owner' | 'other', date: string): Promise<DayVisit[]> {
  const companyId = who === 'owner' ? state.companyId : state.otherCompanyId;
  const businessId = who === 'owner' ? state.businessId : state.otherBusinessId;
  const branchId = who === 'owner' ? state.branchId : state.otherBranchId;
  const url = `${state.apiBase}/v1/businesses/${businessId}/branches/${branchId}/service-sessions?date=${date}`;
  const response = await fetch(url, {
    headers: { cookie: await apiCookie(state, who), 'x-company-id': companyId },
  });
  if (!response.ok) throw new Error(`day list ${response.status}`);
  const body = (await response.json()) as { items: DayVisit[] };
  return body.items;
}

export async function savedVisit(state: E2eState, customer: string, date: string): Promise<DayVisit> {
  const found = (await dayVisits(state, 'owner', date)).find((item) => item.customer.name === customer);
  if (found === undefined) throw new Error('visit missing');
  return found;
}
