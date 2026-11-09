import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { t, type Locale } from '@pospay/i18n';
import {
  ADMIN_ORIGIN,
  DESTINATION_ORIGIN,
  control,
  ledger,
} from './employee-document-popup-fixture';

type Root = Page | FrameLocator;
const openName = (locale: Locale) => t(locale, 'employeeDocuments.open');
async function chooseStaff(root: Root, locale: Locale = 'en') {
  if (locale === 'en' && (await root.locator('html').getAttribute('lang')) !== 'en')
    await root.getByRole('button', { name: t('ar', 'admin.languageEnglish') }).click();
  const company = root.locator('#workspace-company');
  await expect(company).toBeVisible();
  await company.click();
  await root.getByRole('option', { name: 'Synthetic company A', exact: true }).click();
  await root
    .getByRole('button', { name: t(locale, 'staff.edit') })
    .first()
    .click();
  await expect(
    root.getByRole('heading', {
      level: 3,
      name: t(locale, 'employeeDocuments.title'),
    }),
  ).toBeVisible();
}
async function openStaff(page: Page, locale: Locale = 'en') {
  await page.goto('/staff');
  await chooseStaff(page, locale);
}
function openButton(root: Root, row = 'Civil ID', locale: Locale = 'en') {
  return root
    .getByRole('row')
    .filter({ hasText: row })
    .getByRole('button', { name: openName(locale) });
}
async function clickOpen(page: Page, root: Root = page, row = 'Civil ID') {
  const opened = page.context().waitForEvent('page');
  await openButton(root, row).click();
  const popup = await opened;
  await popup.waitForLoadState('domcontentloaded');
  return popup;
}
async function release(key = 'synthetic/civil', outcome = 'success') {
  await expect.poll(async () => (await ledger()).held.includes(key)).toBe(true);
  await control('/release', { key, outcome });
}
async function armActivation(button: ReturnType<typeof openButton>) {
  await button.evaluate((element) => {
    element.addEventListener(
      'click',
      () => {
        document.documentElement.dataset['activation830'] = String(performance.now());
        document.documentElement.dataset['active830'] = String(navigator.userActivation.isActive);
      },
      { once: true },
    );
  });
}
async function activationStart(page: Page) {
  const value = await page.locator('html').getAttribute('data-activation830');
  expect(value).not.toBeNull();
  expect(await page.locator('html').getAttribute('data-active830')).toBe('true');
  return Number(value);
}
async function expiryWithoutOpening(page: Page) {
  const reload = page.getByRole('button', { name: t('en', 'staff.reload') });
  await armActivation(reload as ReturnType<typeof openButton>);
  await reload.click();
  const started = await activationStart(page);
  await page.waitForFunction(() => navigator.userActivation.isActive === false);
  return page.evaluate((start) => performance.now() - start, started);
}
async function holdPastActivation(page: Page, expiry: number) {
  await page.waitForFunction(() => navigator.userActivation.isActive === false);
  const started = await activationStart(page);
  await expect
    .poll(() => page.evaluate((start) => performance.now() - start, started))
    .toBeGreaterThanOrEqual(expiry);
}
async function sandboxStaff(page: Page, permitted: boolean, locale: Locale) {
  await page.goto(`${DESTINATION_ORIGIN}/blank`);
  await page.setContent(
    `<iframe id="app" sandbox="allow-scripts allow-same-origin${permitted ? ' allow-popups' : ''}" src="${ADMIN_ORIGIN}/staff"></iframe>`,
  );
  const frame = page.frameLocator('#app');
  try {
    await chooseStaff(frame, locale);
  } catch (error) {
    const frames = page.frames();
    const states = await Promise.allSettled(
      frames.map((child) =>
        child.evaluate(() => ({
          readyState: document.readyState,
          width: innerWidth,
          height: innerHeight,
          workspaceCount: document.querySelectorAll('#workspace-company').length,
        })),
      ),
    );
    console.error(
      'sandbox setup failed',
      JSON.stringify({
        permitted,
        locale,
        frames: frames.map((child) => child.url().split(/[?#]/, 1)[0]),
        states,
      }),
    );
    throw error;
  }
  return frame;
}
async function nativeFocusCycle(page: Page) {
  await page.evaluate(() => {
    document.documentElement.dataset['focus830'] = '0';
    document.documentElement.dataset['visibility830'] = '0';
    window.addEventListener('focus', () => {
      document.documentElement.dataset['focus830'] = String(
        Number(document.documentElement.dataset['focus830']) + 1,
      );
    });
    document.addEventListener('visibilitychange', () => {
      document.documentElement.dataset['visibility830'] = String(
        Number(document.documentElement.dataset['visibility830']) + 1,
      );
    });
  });
  const other = await page.context().newPage();
  await other.goto(`${DESTINATION_ORIGIN}/blank`);
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('hidden');
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
  expect(Number(await page.locator('html').getAttribute('data-focus830'))).toBeGreaterThan(0);
  expect(Number(await page.locator('html').getAttribute('data-visibility830'))).toBeGreaterThan(0);
  await other.close();
}
async function chooseCompany(page: Page, name: string) {
  await page.locator('#workspace-company').click();
  await page.getByRole('option', { name, exact: true }).click();
}

test.beforeEach(async () => control('/reset'));
test.afterEach(async () => expect((await ledger()).unknown).toEqual([]));

test('trusted click isolates a usable blank before delayed handoff after measured activation expiry', async ({
  page,
}) => {
  await openStaff(page);
  const expiry = await expiryWithoutOpening(page);
  const created: Page[] = [];
  const onCreated = (popup: Page) => created.push(popup);
  page.context().on('page', onCreated);
  try {
    await armActivation(openButton(page));
    const popup = await clickOpen(page);
    expect(
      await popup.evaluate(() => window.opener === null && location.href === 'about:blank'),
    ).toBe(true);
    await expect.poll(async () => (await ledger()).held).toEqual(['synthetic/civil']);
    expect(created).toHaveLength(1);
    expect(
      (await ledger()).requests.filter((entry) => entry.startsWith('POST /v1/files/download')),
    ).toHaveLength(1);
    await expect(openButton(page)).toBeDisabled();
    await expect(openButton(page, 'Passport')).toBeDisabled();
    await holdPastActivation(page, expiry);
    await release();
    await expect(popup).toHaveURL(`${DESTINATION_ORIGIN}/document/civil`);
    await expect(popup.getByRole('heading', { name: 'Synthetic /document/civil' })).toBeVisible();
    expect(created).toHaveLength(1);
  } finally {
    page.context().off('page', onCreated);
  }
});

test('matched sandbox refusal is native, bilingual, POST-free and retryable in the permitted control', async ({
  page,
}) => {
  const denied = await sandboxStaff(page, false, 'ar');
  const pages = page.context().pages().length;
  await openButton(denied, 'Civil ID', 'ar').click();
  await expect(
    denied.getByRole('alert').filter({ hasText: t('ar', 'employeeDocuments.openRetry') }),
  ).toBeVisible();
  expect(page.context().pages()).toHaveLength(pages);
  expect(
    (await ledger()).requests.filter((entry) => entry.startsWith('POST /v1/files/download')),
  ).toEqual([]);
  const permittedPage = await page.context().newPage();
  const permitted = await sandboxStaff(permittedPage, true, 'en');
  const popup = await clickOpen(permittedPage, permitted);
  await release();
  await expect(popup).toHaveURL(`${DESTINATION_ORIGIN}/document/civil`);
});

test('request failure, invalid payload and manual close preserve a safe explicit retry', async ({
  page,
}) => {
  await openStaff(page);
  const failed = await clickOpen(page);
  await release('synthetic/civil', 'network');
  await expect.poll(() => failed.isClosed()).toBe(true);
  await expect(
    page.getByRole('alert').filter({ hasText: t('en', 'employeeDocuments.openRetry') }),
  ).toBeVisible();
  const invalid = await clickOpen(page);
  await release('synthetic/civil', 'invalid');
  await expect.poll(() => invalid.isClosed()).toBe(true);
  await expect(openButton(page)).toBeEnabled();
  const manual = await clickOpen(page);
  await manual.close();
  await release();
  await expect(
    page.getByRole('alert').filter({ hasText: t('en', 'employeeDocuments.openRetry') }),
  ).toBeVisible();
  expect((await ledger()).destinations).toEqual([]);
});

for (const status of [403, 404] as const) {
  test(`real documents GET ${status} closes the placeholder before held POST release`, async ({
    page,
  }) => {
    await openStaff(page);
    const popup = await clickOpen(page);
    await control('/read', { status });
    await nativeFocusCycle(page);
    await expect(page.getByText('Documents are unavailable', { exact: true })).toBeVisible();
    await expect.poll(() => popup.isClosed()).toBe(true);
    const evidence = await ledger();
    expect(
      evidence.requests.filter((entry) => entry.includes('/documents')).length,
    ).toBeGreaterThan(1);
    await release();
    expect((await ledger()).destinations).toEqual([]);
  });
}

test('employee change, panel unmount and workspace change each cancel only their pending placeholder', async ({
  page,
}) => {
  await openStaff(page);
  const employee = await clickOpen(page);
  await page
    .getByRole('button', { name: t('en', 'staff.edit') })
    .nth(1)
    .click();
  await expect.poll(() => employee.isClosed()).toBe(true);
  const panel = await clickOpen(page);
  await page.getByRole('button', { name: t('en', 'staff.cancel') }).click();
  await expect.poll(() => panel.isClosed()).toBe(true);
  await page
    .getByRole('button', { name: t('en', 'staff.edit') })
    .first()
    .click();
  const workspace = await clickOpen(page);
  await chooseCompany(page, 'Synthetic company B');
  await expect.poll(() => workspace.isClosed()).toBe(true);
  await release();
  expect((await ledger()).destinations).toEqual([]);
});

test('old settlement cannot navigate a successor and a handed-off document survives a later failure', async ({
  page,
}) => {
  await openStaff(page);
  const first = await clickOpen(page);
  await release();
  await expect(first).toHaveURL(`${DESTINATION_ORIGIN}/document/civil`);
  const failed = await clickOpen(page, page, 'Passport');
  await release('synthetic/passport', 'network');
  await expect.poll(() => failed.isClosed()).toBe(true);
  expect(first.isClosed()).toBe(false);
  const old = await clickOpen(page, page, 'Passport');
  await page
    .getByRole('button', { name: t('en', 'staff.edit') })
    .nth(1)
    .click();
  await expect.poll(() => old.isClosed()).toBe(true);
  const successor = await clickOpen(page);
  await release();
  await expect(successor).toHaveURL(`${DESTINATION_ORIGIN}/document/civil`);
  await release('synthetic/passport');
  expect((await ledger()).destinations.filter((path) => path === '/document/passport')).toEqual([]);
  expect(first.isClosed()).toBe(false);
});

test('key disappearance, restoration and a fresh read never revive the held attempt', async ({
  page,
}) => {
  const consoleMessages: string[] = [];
  page.on('console', (message) => consoleMessages.push(message.text()));
  await openStaff(page);
  const original = await clickOpen(page);
  await control('/read', { status: 200, omit: 'synthetic/civil' });
  await nativeFocusCycle(page);
  await expect(page.getByRole('row').filter({ hasText: 'Civil ID' })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('download_url');
  await expect.poll(() => original.isClosed()).toBe(true);
  await control('/read', { status: 200, omit: '' });
  await nativeFocusCycle(page);
  await expect(openButton(page)).toBeVisible();
  expect(consoleMessages.join('\n')).not.toContain('download_url');
  await release();
  expect((await ledger()).destinations).toEqual([]);
  const successor = await clickOpen(page);
  await release();
  await expect(successor).toHaveURL(`${DESTINATION_ORIGIN}/document/civil`);
});

test('denial then genuine query recovery leaves the original attempt invalid and the successor independent', async ({
  page,
}) => {
  await openStaff(page);
  const original = await clickOpen(page);
  await control('/read', { status: 403 });
  await nativeFocusCycle(page);
  await expect(page.getByText('Documents are unavailable', { exact: true })).toBeVisible();
  await expect.poll(() => original.isClosed()).toBe(true);
  await control('/read', { status: 200 });
  await nativeFocusCycle(page);
  await expect(openButton(page)).toBeVisible();
  await release();
  expect((await ledger()).destinations).toEqual([]);
  const successor = await clickOpen(page);
  await release();
  await expect(successor).toHaveURL(`${DESTINATION_ORIGIN}/document/civil`);
});

test('records COOP and attachment observations without claiming closure, recall or completion', async ({
  page,
}) => {
  await openStaff(page);
  const coop = await clickOpen(page);
  await release('synthetic/civil', 'coop');
  await expect(coop).toHaveURL(`${DESTINATION_ORIGIN}/document/civil-coop`);
  test.info().annotations.push({
    type: 'COOP observation',
    description: `cross-origin destination reached; popup closed=${coop.isClosed()}; no post-handoff close claimed`,
  });
  const attachment = await clickOpen(page, page, 'Passport');
  const downloadEvent = attachment.waitForEvent('download');
  await release('synthetic/passport', 'attachment');
  const download = await downloadEvent;
  test.info().annotations.push({
    type: 'attachment observation',
    description: `download started as ${download.suggestedFilename()}; byte completion and tab closure not asserted`,
  });
});

test('a closed blank is replaced before the held response settles', async ({ page }) => {
  await openStaff(page);
  const first = await clickOpen(page);
  await expect.poll(async () => (await ledger()).held).toEqual(['synthetic/civil']);
  await first.close();
  await page.bringToFront();
  await expect(openButton(page)).toBeEnabled();
  const successor = await clickOpen(page);
  await expect.poll(async () => (await ledger()).held).toHaveLength(2);
  const oldResponse = page.waitForResponse(
    (response) => response.url().includes('/v1/files/download') && response.status() === 200,
  );
  await release('synthetic/civil', 'coop');
  const response = await oldResponse;
  await response.finished();
  await expect(successor).toHaveURL('about:blank');
  await expect(openButton(page)).toBeDisabled();
  await expect(openButton(page, 'Passport')).toBeDisabled();
  await expect(page.getByText(t('en', 'employeeDocuments.openRetry'))).toHaveCount(0);
  await release();
  await expect(successor).toHaveURL(`${DESTINATION_ORIGIN}/document/civil`);
  await expect(successor.getByRole('heading', { name: 'Synthetic /document/civil' })).toBeVisible();
  expect((await ledger()).destinations.filter((path) => path.includes('civil-coop'))).toEqual([]);
  expect(first.isClosed()).toBe(true);
});
