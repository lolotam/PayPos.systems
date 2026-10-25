// الدوال الصافية: مفيش شبكة ولا clock ولا process — قواعد وأسماء وسطور ثابتة بس.

import { randomBytes } from 'node:crypto';

const DEVICE_LABEL_PREFIX = 'CI-IOS-';
const LEFTOVER_MIN_AGE_MS = 30 * 60_000;

export const FAILURE_MESSAGES = Object.freeze([
  'The counter auth test environment is incomplete',
  'The start screen should be visible',
  'The counter-device choice should be tappable',
  'The pairing-code field should be ready',
  'The device-name field should be ready',
  'The pairing button should be tappable',
  'The approval wait should be visible',
  'Staff sign-in should follow device approval',
  'Staff sign-in should survive the restart',
  'Pairing should not restart',
  'The PIN choice should be tappable',
  'The phone field should be ready',
  'The PIN field should be ready',
  'The PIN sign-in button should be tappable',
  'Staff sign-in should succeed',
  'The staff session should survive the restart',
  'The sign-out button should be tappable',
  'Sign-out should show staff sign-in',
]);

/** تشخيص الفشل بيذكر رسالة معروفة بس، من غير ما يخرج أي سر من سجل xcodebuild الخاص. */
export function failureLine(logText) {
  for (const line of String(logText).split(/\r?\n/)) {
    const message = FAILURE_MESSAGES.find((candidate) => line.includes(candidate));
    if (message !== undefined) return `ui failure: ${message}`;
  }
  return 'ui failure: unknown';
}

/** المطابقة مش حساسة لحالة الحروف: iOS بيعمل auto-capitalisation لاسم الجهاز. */
export function matchDeviceLabel(pages, label) {
  const wanted = String(label).toUpperCase();
  const matches = pages
    .flatMap((page) => page.items)
    .filter((item) => String(item.label).toUpperCase() === wanted);
  if (matches.length > 1) throw new Error('duplicate device label');
  return matches[0]?.id ?? null;
}

/** أسماء الأجهزة اللي سابتها تشغيلات مقتولة: بتبدأ بـ CI-IOS- ولها أكتر من نص ساعة. */
export function leftoverDeviceIds(pages, now, prefix = DEVICE_LABEL_PREFIX) {
  const cutoff = now - LEFTOVER_MIN_AGE_MS;
  const ids = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (typeof item.label !== 'string') continue;
      if (!item.label.toUpperCase().startsWith(prefix)) continue;
      const created = Date.parse(item.created_at);
      if (!Number.isFinite(created) || created >= cutoff) continue;
      if (typeof item.id === 'string' && item.id !== '') ids.push(item.id);
    }
  }
  return ids;
}

/** الاسم لازم يبدأ بحروف كبيرة وأرقام: iOS بيكبّر أول حرف لوحده في حقل «Device name». */
export function buildDeviceLabel(config) {
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `${DEVICE_LABEL_PREFIX}${config.GITHUB_RUN_ID}-${config.GITHUB_RUN_ATTEMPT}-${suffix}`;
}

export function summaryLines(summary) {
  return [
    `owner sign-in: ${summary.owner}`,
    `pairing code: ${summary.pairing}`,
    `device approval: ${summary.approval}`,
    `ui test: ${summary.ui}`,
    `device revoke: ${summary.revoke}`,
    `owner sign-out: ${summary.signOut}`,
    `leftover sweep: ${summary.leftover}`,
  ];
}

export function buildUiTestEnvironment(environment, config, code, label) {
  const inherited = Object.fromEntries(
    Object.entries(environment).filter(([key]) => !key.startsWith('STAGING_UI_')),
  );
  return {
    ...inherited,
    TEST_RUNNER_SPIKE_PAIRING_CODE: code,
    TEST_RUNNER_SPIKE_DEVICE_LABEL: label,
    TEST_RUNNER_SPIKE_STAFF_PHONE: config.STAGING_UI_STAFF_PHONE,
    TEST_RUNNER_SPIKE_STAFF_PIN: config.STAGING_UI_STAFF_PIN,
  };
}
