/**
 * عناوين لا تملك 7a صفحاتها بعد: الإطارات تكتبها كروابط فقط، والإصدار 7b يضيف ملفات المسارات.
 * بقاؤها في ملف واحد يمنع تكرار النص في ثلاثة إطارات.
 */
export const APPEARANCE_HREF = '/appearance';
export const APPROVALS_HREF = '/approvals';
export const TWO_FACTOR_HREF = '/security/two-factor';

export function overviewHref(groupId: string): string {
  return `/overview/${groupId}`;
}
