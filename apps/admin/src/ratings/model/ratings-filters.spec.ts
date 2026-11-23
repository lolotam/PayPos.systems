import { describe, expect, it } from 'vitest';

import {
  availableEmployeeId,
  averagesQuery,
  initialRatingsFilters,
  listRange,
} from './ratings-filters';

describe('the period the screen sends', () => {
  it('sends no month at all until the server has named one, and never a range', () => {
    const filters = initialRatingsFilters();
    expect(averagesQuery(filters)).toEqual({});
    expect(listRange(filters, null)).toBeNull();
  });

  it('sends the chosen month, plus the branch when one branch is chosen', () => {
    const filters = { branchId: 'b1', employeeId: '', month: '2026-10' };
    expect(averagesQuery(filters)).toEqual({ branch_id: 'b1', month: '2026-10' });
    expect(listRange(filters, '2026-10')).toEqual({ branch_id: 'b1', month: '2026-10' });
  });

  it('lists the month the server named while the averages are still sent without one', () => {
    const filters = initialRatingsFilters();
    expect(listRange(filters, '2026-11')).toEqual({ month: '2026-11' });
    expect(averagesQuery(filters)).toEqual({});
  });
});

describe('availableEmployeeId', () => {
  const options = [{ employee_id: 'e1' }, { employee_id: 'e2' }];

  it('keeps a selection that is still an option and falls back to all otherwise', () => {
    expect(availableEmployeeId('e2', options)).toBe('e2');
    expect(availableEmployeeId('e9', options)).toBe('');
    expect(availableEmployeeId('e1', [])).toBe('');
    expect(availableEmployeeId('', options)).toBe('');
  });
});
