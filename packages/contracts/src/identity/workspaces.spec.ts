import { describe, expect, it } from 'vitest';

import committedDocument from '../../openapi/openapi.json' with { type: 'json' };
import { country } from '../reference/country.js';
import { verticalType } from '../tenancy/business.js';
import { workspaceBusiness } from './workspaces.js';

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
      expect(
        workspaceBusiness.safeParse({ ...baseBusiness, business_type: type }).success,
      ).toBe(true);
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
      expect(
        workspaceBusiness.safeParse({ ...baseBusiness, business_type: badType }).success,
      ).toBe(false);
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
