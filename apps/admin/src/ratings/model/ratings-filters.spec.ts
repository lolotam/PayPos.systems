import type { WorkspaceBranch } from '@pospay/contracts';
import { describe, expect, it } from 'vitest';

import { initialRatingsFilters, ratingsQuery } from './ratings-filters';

const berlin = branch('01920000-0000-7000-8000-0000000000b1', 'Europe/Berlin');
const kuwaitOne = branch('01920000-0000-7000-8000-0000000000b2', 'Asia/Kuwait');
const kuwaitTwo = branch('01920000-0000-7000-8000-0000000000b3', 'Asia/Kuwait');

function branch(id: string, effective_timezone: string): WorkspaceBranch {
  return { id, name_ar: null, name_en: 'Synthetic branch', effective_timezone, is_active: true };
}

describe('the period the screen sends', () => {
  it('sends only the month for all branches, never a browser-computed range', () => {
    expect(ratingsQuery({ branchId: '', employeeId: '', month: '2026-10' })).toEqual({
      month: '2026-10',
    });
  });

  it('sends the same month plus the branch when one branch is chosen', () => {
    expect(ratingsQuery({ branchId: berlin.id, employeeId: '', month: '2026-10' })).toEqual({
      branch_id: berlin.id,
      month: '2026-10',
    });
  });
});

describe('the month the field opens on', () => {
  it('is named by the zone most branches share, independent of branch order', () => {
    const lateInUtc = new Date('2026-10-31T22:30:00.000Z');
    expect(initialRatingsFilters([berlin, kuwaitOne, kuwaitTwo], lateInUtc).month).toBe('2026-11');
    expect(initialRatingsFilters([kuwaitTwo, berlin, kuwaitOne], lateInUtc).month).toBe('2026-11');
  });
});
