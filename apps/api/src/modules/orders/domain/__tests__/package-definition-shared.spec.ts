import { expect, it } from 'vitest';
import { packageDefinitionCases } from '../../../../../test/package-definition-cases.ts';
import { validatePackageDefinition } from '../package-definition.ts';

it.each(packageDefinitionCases)('shared definition: $name', ({ price, components, error }) => {
  const check = () => validatePackageDefinition(price, components);
  if (error === null) expect(check).not.toThrow();
  else expect(check).toThrow(error);
});
