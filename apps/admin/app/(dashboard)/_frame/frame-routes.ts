/**
 * عناوين ثابتة تكتبها الإطارات والمسارات كروابط؛ بقاؤها في ملف واحد يمنع تكرار النص في ثلاثة إطارات.
 */
export const HOME_HREF = '/';
export const APPEARANCE_HREF = '/appearance';
export const TWO_FACTOR_HREF = '/security/two-factor';

export function overviewHref(groupId: string): string {
  return `/overview/${groupId}`;
}
