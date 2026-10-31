import { describe, expect, it } from 'vitest';

import { performerLabel, type PerformerName } from '../performer-label.ts';

const named = (nameAr: string | null, nameEn: string | null): PerformerName => ({ nameAr, nameEn });

describe('performer label', () => {
  it.each([
    {
      title: 'lists one performer by his arabic name',
      names: [named('أحمد', 'Ahmed')],
      locale: 'ar' as const,
      expected: 'أحمد',
    },
    {
      title: 'lists one performer by his english name for an english customer',
      names: [named('أحمد', 'Ahmed')],
      locale: 'en' as const,
      expected: 'Ahmed',
    },
    {
      title: 'falls back to english when the arabic name is missing',
      names: [named(null, 'Ahmed')],
      locale: 'ar' as const,
      expected: 'Ahmed',
    },
    {
      title: 'falls back to arabic when the english name is missing',
      names: [named('أحمد', null)],
      locale: 'en' as const,
      expected: 'أحمد',
    },
    {
      title: 'lists three performers with an arabic separator',
      names: [named('أحمد', 'Ahmed'), named('سالم', 'Salem'), named('خالد', 'Khaled')],
      locale: 'ar' as const,
      expected: 'أحمد، سالم، خالد',
    },
    {
      title: 'lists three performers with an english separator',
      names: [named('أحمد', 'Ahmed'), named('سالم', 'Salem'), named('خالد', 'Khaled')],
      locale: 'en' as const,
      expected: 'Ahmed, Salem, Khaled',
    },
    {
      title: 'names the team when the performers are more than three',
      names: [
        named('أحمد', 'Ahmed'),
        named('سالم', 'Salem'),
        named('خالد', 'Khaled'),
        named('ماجد', 'Majed'),
      ],
      locale: 'ar' as const,
      expected: 'فريق مطعم البحر',
    },
    {
      title: 'names the team in english when the performers are more than three',
      names: [
        named('أحمد', 'Ahmed'),
        named('سالم', 'Salem'),
        named('خالد', 'Khaled'),
        named('ماجد', 'Majed'),
      ],
      locale: 'en' as const,
      expected: 'the مطعم البحر team',
    },
    {
      title: 'names the team when no performer has a safe name',
      names: [named(null, null)],
      locale: 'ar' as const,
      expected: 'فريق مطعم البحر',
    },
    {
      title: 'skips the performers without a safe name and keeps the rest',
      names: [named(null, null), named('سالم', 'Salem')],
      locale: 'ar' as const,
      expected: 'سالم',
    },
  ])('$title', ({ names, locale, expected }) => {
    expect(performerLabel(names, 'مطعم البحر', locale)).toBe(expected);
  });
});
