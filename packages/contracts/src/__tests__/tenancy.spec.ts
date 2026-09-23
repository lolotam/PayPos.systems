import { describe, expect, it } from 'vitest';

import { branch, createBranchInput } from '../tenancy/branch.js';
import { pageQuery, type PageQuery, type PageQueryRequest } from '../pagination/cursor.js';
import {
  createBusinessInput,
  type CreateBusinessInput,
  type CreateBusinessRequest,
} from '../tenancy/business.js';
import { company, createCompanyInput } from '../tenancy/company.js';
import { plan } from '../tenancy/plan.js';

const ID = '0190a000-0000-7000-8000-000000000001';
const AT = '2026-09-23T08:00:00Z';

describe('company', () => {
  it('parses a stored company with an optional Arabic name', () => {
    const row = {
      id: ID,
      name_ar: null,
      name_en: 'Salon One',
      owner_user_id: ID,
      plan_id: ID,
      created_at: AT,
      deleted_at: null,
    };
    expect(company.parse(row)).toEqual(row);
  });

  it('create input refuses an id or owner sent by the client', () => {
    const input = { name_en: 'Salon One', plan_id: ID };
    expect(createCompanyInput.safeParse(input).success).toBe(true);
    expect(createCompanyInput.safeParse({ ...input, id: ID }).success).toBe(false);
    expect(createCompanyInput.safeParse({ ...input, owner_user_id: ID }).success).toBe(false);
  });
});

describe('business', () => {
  it('defaults currency to KWD, timezone to Asia/Kuwait and settings to {}', () => {
    expect(createBusinessInput.parse({ vertical_type: 'salon', name_en: 'Main' })).toEqual({
      vertical_type: 'salon',
      name_en: 'Main',
      currency: 'KWD',
      timezone: 'Asia/Kuwait',
      settings: {},
    });
  });

  it('rejects an unknown vertical and a company_id sent by the client', () => {
    expect(createBusinessInput.safeParse({ vertical_type: 'bakery', name_en: 'x' }).success).toBe(
      false,
    );
    expect(
      createBusinessInput.safeParse({ vertical_type: 'salon', name_en: 'x', company_id: ID })
        .success,
    ).toBe(false);
  });
});

describe('branch', () => {
  it('accepts a minimal create input and a full stored branch', () => {
    expect(createBranchInput.safeParse({ name_en: 'Hawalli' }).success).toBe(true);
    const row = {
      id: ID,
      company_id: ID,
      business_id: ID,
      name_ar: 'حولي',
      name_en: 'Hawalli',
      address_ar: 'شارع تونس',
      address_en: 'Tunis Street',
      geo: { lat: 29.33, lng: 48.03 },
      opening_hours: [{ weekday: 1, intervals: [{ opens: '09:00', closes: '22:00' }] }],
      timezone: null,
      effective_timezone: 'Asia/Kuwait',
      is_active: true,
      created_at: AT,
    };
    expect(branch.parse(row)).toEqual(row);
  });

  it('takes an optional IANA time zone on create, and refuses anything else (D-10)', () => {
    expect(createBranchInput.safeParse({ name_en: 'x', timezone: 'Asia/Riyadh' }).success).toBe(
      true,
    );
    expect(createBranchInput.safeParse({ name_en: 'x', timezone: '+03:00' }).success).toBe(false);
  });

  it('refuses a business_id in the body — the business comes from the path', () => {
    expect(createBranchInput.safeParse({ business_id: ID, name_en: 'x' }).success).toBe(false);
  });

  it('rejects coordinates out of range', () => {
    const input = { name_en: 'x', geo: { lat: 91, lng: 0 } };
    expect(createBranchInput.safeParse(input).success).toBe(false);
  });
});

describe('plan', () => {
  it('accepts boolean feature flags keyed by dotted lower-case names', () => {
    const row = {
      id: ID,
      code: 'provisional',
      name_ar: null,
      name_en: 'Provisional',
      feature_flags: { 'pos.offline': true, commissions: false },
    };
    expect(plan.parse(row)).toEqual(row);
    expect(plan.safeParse({ ...row, feature_flags: { 'POS.Offline': true } }).success).toBe(false);
  });
});

describe('request types accept what the API accepts', () => {
  it('a minimal business request type-checks and parses to the full input', () => {
    const request: CreateBusinessRequest = { vertical_type: 'retail', name_en: 'Shop' };
    const parsed: CreateBusinessInput = createBusinessInput.parse(request);
    expect(parsed.currency).toBe('KWD');
  });

  it('a page request may omit the limit', () => {
    const request: PageQueryRequest = {};
    const parsed: PageQuery = pageQuery.parse(request);
    expect(parsed.limit).toBe(20);
  });
});
