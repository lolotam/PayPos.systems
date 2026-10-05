import { test, expect } from '@playwright/test';
import { t } from '@pospay/i18n';
import { pairedPage, requestCode, verifyCode, staffFixture } from './staff-fixture';

test('phone → code → server session, cookies plus Device, logout clears every tab', async ({
  context,
  page,
}) => {
  const state = await staffFixture(context);
  await pairedPage(page);
  await requestCode(page);
  await verifyCode(page);
  await expect(page.getByRole('heading', { name: t('ar', 'staffLogin.signedIn') })).toBeVisible();
  expect(state.deviceHeader).toBe(true);
  expect(state.cookieHeader).toBe(true);
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByRole('heading', { name: t('ar', 'staffLogin.signedIn') })).toBeVisible();
  await page.getByRole('button', { name: t('ar', 'staffLogin.signOut') }).click();
  await expect(other.getByRole('heading', { name: t('ar', 'staffLogin.title') })).toBeVisible();
  await expect(page.getByLabel(t('ar', 'staffLogin.phone'))).toHaveValue('');
});
test('wrong code is generic; countdown creates a new challenge and an old response never selects the old id', async ({
  context,
  page,
}) => {
  const state = await staffFixture(context);
  await pairedPage(page);
  await page.clock.install();
  await requestCode(page);
  await verifyCode(page, String(1).padStart(6, '0'));
  await expect(page.getByRole('alert')).toHaveText(t('ar', 'errors.OTP_INVALID'));
  const previous = state.challenge;
  await expect(page.getByRole('button', { name: t('ar', 'staffLogin.newCode') })).toBeDisabled();
  await page.clock.fastForward(60_000);
  await page.getByRole('button', { name: t('ar', 'staffLogin.newCode') }).click();
  await expect.poll(() => state.challenge).not.toBe(previous);
  await verifyCode(page);
  expect(state.verifiedChallenge).toBe(state.challenge);
});
for (const scenario of ['unknown', 'nonmember', 'suppressed'] as const) {
  test(`${scenario} has identical common recovery and own-PIN entry`, async ({ context, page }) => {
    await staffFixture(context);
    await pairedPage(page);
    await requestCode(page);
    await expect(page.getByText(t('ar', 'staffLogin.recovery'))).toBeVisible();
    await page.getByRole('button', { name: t('ar', 'staffLogin.usePin') }).click();
    await expect(page.getByLabel(t('ar', 'staffLogin.ownPin'))).toHaveValue('');
    expect(await page.evaluate(() => localStorage.getItem('staff-phone'))).toBeNull();
  });
}
test('disabled capability exposes the same real own-PIN fallback without manager impersonation', async ({
  context,
  page,
}) => {
  const state = await staffFixture(context);
  state.unavailable = true;
  await pairedPage(page);
  await requestCode(page);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: t('ar', 'staffLogin.usePin') }).click();
  await page.getByLabel(t('ar', 'staffLogin.phone')).fill('+99900000001');
  await page.getByLabel(t('ar', 'staffLogin.ownPin')).fill(String(20).padStart(4, '0'));
  await page.getByRole('button', { name: t('ar', 'staffLogin.pinSignIn') }).click();
  await expect(page.getByRole('alert')).toHaveText(t('ar', 'staffLogin.pinInvalid'));
  await page.getByLabel(t('ar', 'staffLogin.ownPin')).fill(String(10).padStart(4, '0'));
  await page.getByRole('button', { name: t('ar', 'staffLogin.pinSignIn') }).click();
  await expect(page.getByRole('heading', { name: t('ar', 'staffLogin.signedIn') })).toBeVisible();
});
test('a new operator replaces only after accepted proof and both tabs revalidate', async ({
  context,
  page,
}) => {
  const state = await staffFixture(context);
  await pairedPage(page);
  await requestCode(page);
  await verifyCode(page);
  await expect(page.getByRole('heading', { name: t('ar', 'staffLogin.signedIn') })).toBeVisible();
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByRole('heading', { name: t('ar', 'staffLogin.signedIn') })).toBeVisible();
  await page.getByRole('button', { name: t('ar', 'staffLogin.switchOperator') }).click();
  const previousUser = state.userId;
  await requestCode(page, '+99900000002');
  await verifyCode(page, String(1).padStart(6, '0'));
  expect(state.operator).toBe(true);
  await expect(other.getByRole('heading', { name: t('ar', 'staffLogin.signedIn') })).toBeVisible();
  const probes = state.probes;
  await verifyCode(page);
  expect(state.userId).not.toBe(previousUser);
  await expect.poll(() => state.probes).toBeGreaterThan(probes);
  await expect(page.getByRole('heading', { name: t('ar', 'staffLogin.signedIn') })).toBeVisible();
  await expect(other.getByRole('heading', { name: t('ar', 'staffLogin.signedIn') })).toBeVisible();
});
test('offline removes private access; reconnect and revocation require a new server probe', async ({
  context,
  page,
}) => {
  const state = await staffFixture(context);
  await pairedPage(page);
  await requestCode(page);
  await verifyCode(page);
  await expect(page.getByRole('heading', { name: t('ar', 'staffLogin.signedIn') })).toBeVisible();
  await context.setOffline(true);
  await expect(
    page.getByRole('heading', { name: t('ar', 'staffLogin.signedIn') }),
  ).not.toBeVisible();
  const probes = state.probes;
  state.operator = false;
  await context.setOffline(false);
  await expect.poll(() => state.probes).toBeGreaterThan(probes);
  await expect(page.getByRole('heading', { name: t('ar', 'staffLogin.title') })).toBeVisible();
  state.revoked = true;
  await page.reload();
  await expect(page.getByRole('heading', { name: t('ar', 'staffLogin.title') })).not.toBeVisible();
});
for (const phase of ['request', 'verify'] as const) {
  test(`offline during ${phase} cannot expose private access or persist a login command`, async ({
    context,
    page,
  }) => {
    const state = await staffFixture(context);
    await pairedPage(page);
    if (phase === 'verify') await requestCode(page);
    let release: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    await context.route(`**/staff-otp/${phase}`, async (route) => {
      entered = true;
      await waiting;
      await route.fallback();
    });
    if (phase === 'request') await requestCode(page);
    else await verifyCode(page);
    await expect.poll(() => entered).toBe(true);
    await context.setOffline(true);
    release();
    await expect(
      page.getByRole('heading', { name: t('ar', 'staffLogin.signedIn') }),
    ).not.toBeVisible();
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((key) => /phone|code|challenge|login-command/.test(key)),
      ),
    ).toEqual([]);
    const probes = state.probes;
    await context.setOffline(false);
    await expect.poll(() => state.probes).toBeGreaterThan(probes);
  });
}
