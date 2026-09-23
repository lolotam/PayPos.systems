import { describe, expect, it } from 'vitest';

import committed from '../../openapi/openapi.json' with { type: 'json' };
import { buildOpenApiDocument } from '../openapi.js';

describe('openapi/openapi.json', () => {
  it('matches the contracts — run `pnpm contracts:openapi` after changing a schema', () => {
    expect(buildOpenApiDocument()).toEqual(committed);
  });

  it('publishes every tenancy schema with no $id inside a component', () => {
    const schemas = (buildOpenApiDocument()['components'] as { schemas: Record<string, object> })
      .schemas;
    expect(Object.keys(schemas).sort()).toEqual([
      'Branch',
      'Business',
      'Company',
      'CreateBranchInput',
      'CreateBusinessInput',
      'CreateCompanyInput',
      'ErrorEnvelope',
      'GeoPoint',
      'OpeningHours',
      'PageQuery',
      'Plan',
      'VerticalType',
    ]);
    for (const schema of Object.values(schemas)) {
      expect(schema).not.toHaveProperty('$id');
    }
  });
});
