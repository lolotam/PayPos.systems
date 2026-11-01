import { describe, expect, it } from 'vitest';

import { businessDisplayName } from '../business-display-name.ts';

const ARABIC = 'مطعم البحر';
const ENGLISH = 'Sea Restaurant';

describe('business display name', () => {
  it('picks the arabic name for an arabic customer', () => {
    expect(businessDisplayName({ name_ar: ARABIC, name_en: ENGLISH }, 'ar')).toBe(ARABIC);
  });

  it('falls back to the english name when the arabic name is not saved', () => {
    expect(businessDisplayName({ name_ar: null, name_en: ENGLISH }, 'ar')).toBe(ENGLISH);
  });

  it('falls back to the english name when the arabic name is empty', () => {
    expect(businessDisplayName({ name_ar: '', name_en: ENGLISH }, 'ar')).toBe(ENGLISH);
  });

  it('falls back to the english name when the arabic name is only spaces', () => {
    expect(businessDisplayName({ name_ar: '   ', name_en: ENGLISH }, 'ar')).toBe(ENGLISH);
  });

  it('keeps the arabic name with its surrounding spaces', () => {
    expect(businessDisplayName({ name_ar: `  ${ARABIC}  `, name_en: ENGLISH }, 'ar')).toBe(
      `  ${ARABIC}  `,
    );
  });

  it('picks the english name for an english customer even when an arabic name exists', () => {
    expect(businessDisplayName({ name_ar: ARABIC, name_en: ENGLISH }, 'en')).toBe(ENGLISH);
  });

  it('picks the english name for an english customer without an arabic name', () => {
    expect(businessDisplayName({ name_ar: null, name_en: ENGLISH }, 'en')).toBe(ENGLISH);
  });
});
