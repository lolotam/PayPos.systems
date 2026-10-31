import { describe, expect, it } from 'vitest';

import { performerLabel, type PerformerName } from '../performer-label.ts';

const named = (nameAr: string | null, nameEn: string | null): PerformerName => ({ nameAr, nameEn });
const AHMED = named('أحمد', 'Ahmed');
const SALEM = named('سالم', 'Salem');
const KHALED = named('خالد', 'Khaled');
const MAJED = named('ماجد', 'Majed');
const UNNAMED = named(null, null);

describe('performer label names', () => {
  it('lists one performer by his arabic name', () => {
    expect(performerLabel([AHMED], 'ar')).toEqual({ kind: 'NAMES', names: ['أحمد'] });
  });

  it('lists one performer by his english name', () => {
    expect(performerLabel([AHMED], 'en')).toEqual({ kind: 'NAMES', names: ['Ahmed'] });
  });

  it('falls back to english when the arabic name is missing', () => {
    const onlyEnglish = named(null, 'Ahmed');
    expect(performerLabel([onlyEnglish], 'ar')).toEqual({ kind: 'NAMES', names: ['Ahmed'] });
  });

  it('falls back to arabic when the english name is missing', () => {
    const onlyArabic = named('أحمد', null);
    expect(performerLabel([onlyArabic], 'en')).toEqual({ kind: 'NAMES', names: ['أحمد'] });
  });

  it('lists three performers in the order they came', () => {
    expect(performerLabel([AHMED, SALEM, KHALED], 'ar')).toEqual({
      kind: 'NAMES',
      names: ['أحمد', 'سالم', 'خالد'],
    });
  });
});

describe('performer label team', () => {
  it('names the team when the performers are more than three', () => {
    expect(performerLabel([AHMED, SALEM, KHALED, MAJED], 'ar')).toEqual({ kind: 'TEAM' });
  });

  it('names the team when no performer has a safe name', () => {
    expect(performerLabel([UNNAMED], 'ar')).toEqual({ kind: 'TEAM' });
  });

  it('skips the performers without a safe name and keeps the rest', () => {
    expect(performerLabel([UNNAMED, SALEM], 'ar')).toEqual({ kind: 'NAMES', names: ['سالم'] });
  });
});
