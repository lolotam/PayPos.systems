import { describe, expect, it } from 'vitest';

import { ratingNamesLabel, ratingTeamLabel } from '../rating-label.js';

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
