// الدوال الصافية: مفيش شبكة ولا clock ولا process — قواعد وأسماء وسطور ثابتة بس.

import { randomBytes } from 'node:crypto';

const DEVICE_LABEL_PREFIX = 'CI-IOS-';
const LEFTOVER_MIN_AGE_MS = 30 * 60_000;

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
