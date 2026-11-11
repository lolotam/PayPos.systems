import { expect, type Page } from '@playwright/test';
import { ledger } from './employee-document-popup-fixture';

/**
 * يستعمل أحداث اتصال حقيقية لإعادة قراءة الوثائق؛ headless لا يغيّر visibility بين التبويبات.
 * طلب الفتح يظل معلقًا حتى نثبت أثر القراءة الجديدة على الواجهة والنافذة.
 */
export async function reconnectDocuments(page: Page, status = 200) {
  await expect.poll(async () => (await ledger()).liveHeld.length).toBeGreaterThan(0);
  const before = await ledger();
  const held = before.liveHeld;
  expect(held.length).toBeGreaterThan(0);
  expect(held.map((request) => request.key)).toEqual(before.held);
  await page.evaluate(() => {
    document.documentElement.dataset['connection830'] = '';
    window.addEventListener(
      'offline',
      () => (document.documentElement.dataset['connection830'] = 'offline'),
      { once: true },
    );
    window.addEventListener(
      'online',
      () => (document.documentElement.dataset['connection830'] = 'online'),
      { once: true },
    );
  });
  const read = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname.endsWith('/documents'),
  );
  await page.context().setOffline(true);
  await expect(page.locator('html')).toHaveAttribute('data-connection830', 'offline');
  await page.context().setOffline(false);
  await expect(page.locator('html')).toHaveAttribute('data-connection830', 'online');
  const response = await read;
  expect(response.status()).toBe(status);
  await response.finished();
  const after = await ledger();
  expect(
    after.aborted.filter((request) => held.some((pending) => pending.id === request.id)),
  ).toEqual([]);
  expect(after.liveHeld).toEqual(held);
  expect(after.held).toEqual(before.held);
}
