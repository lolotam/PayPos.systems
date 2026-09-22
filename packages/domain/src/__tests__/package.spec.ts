import { describe, expect, it } from 'vitest';

import pkg from '../../package.json' with { type: 'json' };

describe('@pospay/domain package', () => {
  it('has zero runtime dependencies, so the POS browser bundle can import it', () => {
    expect(pkg.dependencies).toEqual({});
  });
});
