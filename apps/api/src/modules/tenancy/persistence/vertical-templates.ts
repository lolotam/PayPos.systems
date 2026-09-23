import { verticalTemplate } from '@pospay/db';

import type { VerticalTemplates } from '../ports/tenancy-transactions.port.ts';

// The contract's verticalType enum and the JSON's keys are asserted equal in packages/db (seed.spec.ts).
export const jsonVerticalTemplates: VerticalTemplates = {
  settingsFor: (vertical) => {
    const template = verticalTemplate(vertical);
    return template === undefined
      ? {}
      : { modules: [...template.modules], features: [...template.features] };
  },
};
