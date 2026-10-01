import { afterEach, describe, expect, it } from 'vitest';

import {
  BRANCH_COOKIE,
  BUSINESS_COOKIE,
  clearSelection,
  COMPANY_COOKIE,
  readSelection,
  selectionMatches,
  writeSelection,
} from './selection-cookie';

const COMPANY_ID = '01923f66-3d2b-7c00-8000-000000000001';
const BUSINESS_ID = '01923f66-3d2b-7c00-8000-000000000002';
const BRANCH_ID = '01923f66-3d2b-7c00-8000-000000000003';

describe('selection-cookie', () => {
  afterEach(() => {
    clearSelection();
  });

  it('performs write and read round trip with valid UUIDs', () => {
    writeSelection({
      companyId: COMPANY_ID,
      businessId: BUSINESS_ID,
      branchId: BRANCH_ID,
    });

    expect(readSelection()).toEqual({
      companyId: COMPANY_ID,
      businessId: BUSINESS_ID,
      branchId: BRANCH_ID,
    });
  });

  it('ignores non-UUID values on read', () => {
    document.cookie = `${COMPANY_COOKIE}=not-a-uuid; Path=/`;
    document.cookie = `${BUSINESS_COOKIE}=12345; Path=/`;
    document.cookie = `${BRANCH_COOKIE}=; Path=/`;

    expect(readSelection()).toEqual({
      companyId: undefined,
      businessId: undefined,
      branchId: undefined,
    });
  });

  it('clears cookie when writing a non-UUID value', () => {
    writeSelection({ companyId: COMPANY_ID });
    expect(readSelection().companyId).toBe(COMPANY_ID);

    writeSelection({ companyId: 'invalid-uuid-value' });
    expect(readSelection().companyId).toBeUndefined();
  });

  it('removes all three cookies with clearSelection', () => {
    writeSelection({
      companyId: COMPANY_ID,
      businessId: BUSINESS_ID,
      branchId: BRANCH_ID,
    });

    clearSelection();

    expect(readSelection()).toEqual({
      companyId: undefined,
      businessId: undefined,
      branchId: undefined,
    });
  });

  it('correctly compares selections with selectionMatches', () => {
    const selA = { companyId: COMPANY_ID, businessId: BUSINESS_ID, branchId: BRANCH_ID };
    const selB = { companyId: COMPANY_ID, businessId: BUSINESS_ID, branchId: BRANCH_ID };
    const selDifferent = { companyId: COMPANY_ID, businessId: BUSINESS_ID, branchId: undefined };

    expect(selectionMatches(selA, selB)).toBe(true);
    expect(selectionMatches(selA, selDifferent)).toBe(false);
    expect(selectionMatches(selA, { ...selA, companyId: '01923f66-3d2b-7c00-8000-000000000009' })).toBe(false);
  });
});
