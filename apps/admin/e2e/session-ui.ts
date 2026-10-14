import { expect, type APIResponse, type Locator, type Page, type Response } from '@playwright/test';
import { t, type Locale } from '@pospay/i18n';

import { type E2eState } from './session-state';
import { freshTotp } from './totp';

function byLabel(root: Page | Locator, name: string): Locator {
  return root.getByLabel(name, { exact: true });
}

export interface LineSpec {
  readonly serviceName: string;
  readonly catalogPrice: string;
  readonly price?: string;
  readonly discount: { readonly kind: 'AMOUNT' | 'PERCENT'; readonly value: string };
  readonly performers: readonly string[];
  readonly shares?: readonly string[];
}

export interface RecordedVisit {
  readonly outcome: string;
  readonly session: {
    readonly id: string;
    readonly business_date: string;
    readonly business_timezone: string;
    readonly recorded_by_membership_id: string;
    readonly lines: readonly {
      readonly id: string;
      readonly recorded_by_membership_id: string;
      readonly limit_bps_applied: number | null;
      readonly limit_source: string;
      readonly performers: readonly {
        readonly employee_id: string;
        readonly share_bps: number;
        readonly not_clocked_in_warning: boolean;
        readonly approved_leave_warning: boolean;
      }[];
    }[];
  };
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

function contextFor(response: Response, branchId: string): boolean {
  return (
    response.request().method() === 'GET' &&
    response.ok() &&
    new URL(response.url()).pathname.includes(`/branches/${branchId}/service-sessions/recording-context`)
  );
}

function timeZoneOf(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('business_timezone' in body)) {
    throw new Error('e2e timezone missing');
  }
  const zone = body.business_timezone;
  if (typeof zone !== 'string' || zone === '') throw new Error('e2e timezone missing');
  return zone;
}

export function membershipLimit(page: Page, locale: Locale): Locator {
  return byLabel(page, t(locale, 'serviceSessions.recorderMembership')).locator('xpath=ancestor::fieldset[1]').getByRole('status').locator('bdi');
}

export function limitPercent(locale: Locale, value: string): string {
  return t(locale, 'serviceSessions.percentValue').replace('{value}', value);
}

async function chooseMembership(page: Page, locale: Locale, membershipId: string): Promise<void> {
  const field = byLabel(page, t(locale, 'serviceSessions.recorderMembership'));
  await expect(field.locator(`option[value="${membershipId}"]`)).toHaveCount(1);
  await field.selectOption(membershipId);
  await expect(membershipLimit(page, locale)).toHaveText(limitPercent(locale, '10.00'));
}

export async function openRecorder(page: Page, state: E2eState, locale: Locale): Promise<string> {
  await page.goto('/login');
  await useLocale(page, locale);
  await signInThroughUi(page, state.recorderEmail, state.recorderPassword, state.recorderTotpSecret);
  const pending = page.waitForResponse((response) => contextFor(response, state.branchId), { timeout: 20_000 });
  await page.goto('/orders/service-sessions/new');
  await chooseCompany(page, state.companyName);
  const zone = timeZoneOf(await (await pending).json());
  await expect(page.getByRole('heading', { name: t(locale, 'serviceSessions.title') })).toBeVisible();
  await chooseMembership(page, locale, state.recorderMembershipId);
  return zone;
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

async function applyDiscount(group: Locator, locale: Locale, discount: LineSpec['discount']): Promise<void> {
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
    const performer = byLabel(group, t(locale, 'serviceSessions.performerNumber').replace('{n}', String(index + 1)));
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

export async function readRecorded(response: Response): Promise<RecordedVisit> {
  expect(response.status()).toBe(201);
  return (await response.json()) as RecordedVisit;
}

export async function dropFirstCreate(page: Page): Promise<() => Promise<APIResponse>> {
  let dropped = false;
  let resolve: (response: APIResponse) => void = () => undefined;
  const pending = new Promise<APIResponse>((done) => {
    resolve = done;
  });
  await page.route(
    (url) => /\/service-sessions$/u.test(url.pathname),
    async (route) => {
      const request = route.request();
      if (dropped || !isCreatePost(request.url(), request.method())) {
        await route.continue();
        return;
      }
      dropped = true;
      const fetched = await route.fetch();
      resolve(fetched);
      await route.abort('failed');
    },
  );
  return () => pending;
}

export async function holdFirstCreate(page: Page): Promise<void> {
  let dropped = false;
  await page.route(
    (url) => /\/service-sessions$/u.test(url.pathname),
    async (route) => {
      const request = route.request();
      if (dropped || !isCreatePost(request.url(), request.method())) {
        await route.continue();
        return;
      }
      dropped = true;
      await route.abort('failed');
    },
  );
}

export async function staysQuiet(read: () => Promise<boolean>, quietMs = 1_500): Promise<void> {
  const started = Date.now();
  let drifted = false;
  await expect
    .poll(
      async () => {
        if (!(await read())) drifted = true;
        return !drifted && Date.now() - started >= quietMs;
      },
      { timeout: quietMs + 10_000, intervals: [200] },
    )
    .toBe(true);
}
