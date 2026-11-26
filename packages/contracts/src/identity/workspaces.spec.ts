import { describe, expect, it } from 'vitest';

import committedDocument from '../../openapi/openapi.json' with { type: 'json' };
import { country } from '../reference/country.js';
import { verticalType } from '../tenancy/business.js';
import { myWorkspacesReadResponse, myWorkspacesResponse, workspaceBusiness } from './workspaces.js';

const baseBusiness = {
  id: '01920000-0000-7000-8000-0000000000a4',
  name_ar: null,
  name_en: 'North Shop',
  business_type: 'retail' as const,
  country: 'KW' as const,
  branches: [],
};

describe('workspaceBusiness contract (074-0c)', () => {
  it('accepts every vertical type, every country code, and explicit null country', () => {
    for (const type of verticalType.options) {
      expect(workspaceBusiness.safeParse({ ...baseBusiness, business_type: type }).success).toBe(
        true,
      );
    }
    for (const code of [...country.options, null]) {
      expect(workspaceBusiness.safeParse({ ...baseBusiness, country: code }).success).toBe(true);
    }
  });

  it('rejects missing or invalid business_type and country values', () => {
    for (const badCountry of ['XX', 'kw', '', 965, undefined]) {
      expect(workspaceBusiness.safeParse({ ...baseBusiness, country: badCountry }).success).toBe(
        false,
      );
    }
    for (const badType of ['pharmacy', 'RETAIL', null, undefined]) {
      expect(workspaceBusiness.safeParse({ ...baseBusiness, business_type: badType }).success).toBe(
        false,
      );
    }
  });

  it('emits business_type and a nullable OpenAPI 3.0.3 country enum on WorkspaceBusiness', () => {
    const schema = committedDocument.components.schemas.WorkspaceBusiness;
    expect(schema.required).toEqual(expect.arrayContaining(['business_type', 'country']));
    expect(schema.properties.business_type).toEqual({
      $ref: '#/components/schemas/VerticalType',
    });
    expect(schema.properties.country).toEqual({
      type: 'string',
      nullable: true,
      enum: [...country.options, null],
    });
  });
});

it('accepts an older workspace response without guessing its business type or country', () => {
  const previous = {
    id: baseBusiness.id,
    name_ar: null,
    name_en: baseBusiness.name_en,
    branches: [],
  };
  const company = {
    id: baseBusiness.id,
    name_ar: null,
    name_en: 'Company',
    role_code: 'owner',
    scope: 'COMPANY',
  };
  const body = {
    companies: [{ ...company, businesses: [previous, baseBusiness] }],
    capabilities: { staff_access: false },
  };

  expect(myWorkspacesReadResponse.parse(body)).toEqual(body);
  expect(myWorkspacesResponse.safeParse(body).success).toBe(false);
  expect(
    myWorkspacesReadResponse.safeParse({
      companies: [{ ...company, businesses: [{ ...previous, business_type: 'invalid' }] }],
    }).success,
  ).toBe(false);
});

describe('workspace business logo reference (079 TQ-1)', () => {
  it('accepts a uuid logo reference, an explicit null, and none at all', () => {
    const uuid = '01920000-0000-7000-8000-0000000000b1';
    expect(workspaceBusiness.safeParse({ ...baseBusiness, logo_file_id: uuid }).success).toBe(true);
    expect(workspaceBusiness.safeParse({ ...baseBusiness, logo_file_id: null }).success).toBe(true);
    expect(workspaceBusiness.safeParse(baseBusiness).success).toBe(true);
    expect(
      workspaceBusiness.safeParse({ ...baseBusiness, logo_file_id: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('publishes the optional nullable logo reference on WorkspaceBusiness', () => {
    const schema = committedDocument.components.schemas.WorkspaceBusiness;
    expect(schema.required).not.toContain('logo_file_id');
    expect(schema.properties.logo_file_id).toMatchObject({
      type: 'string',
      format: 'uuid',
      nullable: true,
    });
  });
});

describe('workspace per-business scope (1133)', () => {
  it('accepts every scope on a business, and none at all for an older API', () => {
    for (const scope of ['COMPANY', 'BUSINESS', 'BRANCH']) {
      expect(workspaceBusiness.safeParse({ ...baseBusiness, scope }).success).toBe(true);
    }
    expect(workspaceBusiness.safeParse(baseBusiness).success).toBe(true);
  });

  it('rejects a scope that is not one of the three memberships', () => {
    for (const scope of ['branch', 'business', '', null, 1]) {
      expect(workspaceBusiness.safeParse({ ...baseBusiness, scope }).success).toBe(false);
    }
  });

  it('publishes the optional scope on WorkspaceBusiness', () => {
    const schema = committedDocument.components.schemas.WorkspaceBusiness;
    expect(schema.required).not.toContain('scope');
    expect(schema.properties.scope).toEqual({
      type: 'string',
      enum: ['COMPANY', 'BUSINESS', 'BRANCH'],
    });
  });

  it('keeps the company scope required and unchanged', () => {
    const schema = committedDocument.components.schemas.WorkspaceCompany;
    expect(schema.required).toContain('scope');
    expect(schema.properties.scope).toEqual({
      type: 'string',
      enum: ['COMPANY', 'BUSINESS', 'BRANCH'],
    });
  });
});

describe('workspace staff-access capability contract (076 A1)', () => {
  it('carries the staff-access flag on a workspace read', () => {
    const body = { companies: [], capabilities: { staff_access: false } };
    expect(myWorkspacesReadResponse.parse(body)).toEqual(body);
  });

  it('a workspace read from an older API without capabilities still parses', () => {
    const parsed = myWorkspacesReadResponse.parse({ companies: [] });
    expect(parsed.capabilities).toBeUndefined();
  });

  it('a present capabilities object on a workspace read must carry a boolean staff_access', () => {
    for (const capabilities of [{}, { staff_access: 'yes' }]) {
      expect(myWorkspacesReadResponse.safeParse({ companies: [], capabilities }).success).toBe(
        false,
      );
    }
    const parsed = myWorkspacesReadResponse.parse({
      companies: [],
      capabilities: { staff_access: true, extra: 1 },
    });
    expect(parsed.capabilities).toEqual({ staff_access: true });
  });

  it('the response contract itself still requires capabilities', () => {
    expect(myWorkspacesResponse.safeParse({ companies: [] }).success).toBe(false);
    expect(
      myWorkspacesResponse.safeParse({ companies: [], capabilities: { staff_access: false } })
        .success,
    ).toBe(true);
  });

  it('publishes the required capability field in OpenAPI', () => {
    const schema = committedDocument.components.schemas.WorkspaceCapabilities;
    expect(schema.required).toEqual(['staff_access']);
    expect(schema.properties.staff_access).toEqual({ type: 'boolean' });
  });
});
