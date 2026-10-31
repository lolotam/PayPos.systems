import { describe, expect, it } from 'vitest';

import {
  RATING_LABEL_TEXT_MAX,
  ratingBusinessName,
  ratingNamesLabel,
  ratingTeamLabel,
} from '../rating-label.js';

describe('rating business name', () => {
  it.each([
    { locale: 'arabic', name: 'مطعم البحر' },
    { locale: 'english', name: 'Sea Restaurant' },
  ])('keeps an ordinary $locale name unchanged', ({ name }) => {
    expect(ratingBusinessName(name)).toBe(name);
  });

  it('keeps a name at the UTF-16 contract cap unchanged', () => {
    const name = 'ب'.repeat(RATING_LABEL_TEXT_MAX);
    expect(ratingBusinessName(name)).toBe(name);
  });

  it('shortens only an over-limit name without splitting a surrogate pair', () => {
    const name = '😀'.repeat(128);
    expect(name).toHaveLength(RATING_LABEL_TEXT_MAX + 1);
    expect(ratingBusinessName(name)).toBe(`${'😀'.repeat(127)}…`);
    expect(ratingBusinessName(name)).toHaveLength(RATING_LABEL_TEXT_MAX);
  });
});

describe('rating team label', () => {
  it('puts the business name inside the arabic label', () => {
    expect(ratingTeamLabel('ar', 'مطعم البحر')).toBe('فريق مطعم البحر');
  });

  it('puts the business name inside the english label', () => {
    expect(ratingTeamLabel('en', 'Sea Restaurant')).toBe('the Sea Restaurant team');
  });
});

describe('rating names label', () => {
  it('joins the performer names with the arabic separator', () => {
    expect(ratingNamesLabel('ar', ['أحمد', 'سالم'])).toBe('أحمد، سالم');
  });

  it('joins the performer names with the english separator', () => {
    expect(ratingNamesLabel('en', ['Ahmed', 'Salem'])).toBe('Ahmed, Salem');
  });
});

describe('rating label at the display cap', () => {
  it('keeps a team label that reaches the cap exactly as it is', () => {
    const business = 'B'.repeat(RATING_LABEL_TEXT_MAX - 'the  team'.length);
    expect(ratingTeamLabel('en', business)).toBe(`the ${business} team`);
  });

  it('keeps the team prefix and suffix and shortens the business name over the cap', () => {
    const business = 'B'.repeat(RATING_LABEL_TEXT_MAX);
    const label = ratingTeamLabel('en', business);
    expect(label.length).toBe(RATING_LABEL_TEXT_MAX);
    expect(label.startsWith('the ')).toBe(true);
    expect(label.endsWith(' team')).toBe(true);
    expect(label).toContain('…');
  });

  it('keeps the arabic team prefix and suffix and shortens the business name', () => {
    const business = 'م'.repeat(RATING_LABEL_TEXT_MAX);
    const label = ratingTeamLabel('ar', business);
    expect(label.length).toBe(RATING_LABEL_TEXT_MAX);
    expect(label.startsWith('فريق ')).toBe(true);
    expect(label.endsWith('…')).toBe(true);
  });

  it('keeps a names label that reaches the cap exactly as it is', () => {
    const name = 'س'.repeat(RATING_LABEL_TEXT_MAX);
    expect(ratingNamesLabel('ar', [name])).toBe(name);
  });

  it('shortens one name over the cap', () => {
    const label = ratingNamesLabel('en', ['x'.repeat(RATING_LABEL_TEXT_MAX + 1)]);
    expect(label.length).toBe(RATING_LABEL_TEXT_MAX);
    expect(label.endsWith('…')).toBe(true);
  });

  it('shortens several long names and keeps every name in the label', () => {
    const names = ['أ'.repeat(128), 'ب'.repeat(128), 'ج'.repeat(128)];
    const label = ratingNamesLabel('ar', names);
    expect(label.length).toBeLessThanOrEqual(RATING_LABEL_TEXT_MAX);
    expect(label.split('، ')).toHaveLength(3);
    for (const part of label.split('، ')) expect(part.endsWith('…')).toBe(true);
  });

  it('shortens the long name only and leaves the short one whole', () => {
    const label = ratingNamesLabel('en', ['Ahmed', 'S'.repeat(250)]);
    expect(label.startsWith('Ahmed, ')).toBe(true);
    expect(label.length).toBeLessThanOrEqual(RATING_LABEL_TEXT_MAX);
  });

  it('never splits a surrogate pair when it shortens', () => {
    const label = ratingNamesLabel('en', ['😀'.repeat(200)]);
    expect(label).toBe(`${'😀'.repeat(127)}…`);
    expect(label.length).toBe(RATING_LABEL_TEXT_MAX);
  });

  it('keeps a mixed arabic and english label under the cap', () => {
    const label = ratingNamesLabel('ar', ['مطعم'.repeat(60), '😀 Sea'.repeat(40)]);
    expect(label.length).toBeLessThanOrEqual(RATING_LABEL_TEXT_MAX);
    // الإيموجي في الاسم التاني لسه موجود كامل، ما اتقص نص نص.
    expect(label).toContain('😀');
    expect(label.endsWith('…')).toBe(true);
  });
});
