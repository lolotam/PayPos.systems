import type { ExecutionContext } from '@nestjs/common';
import type { Principal } from '@pospay/auth';
import { expect, it } from 'vitest';

import { SelectedCompanyGuard } from '../selected-company.guard.ts';

it.each(['device', 'api-key'] as const)(
  'refuses %s even with a user id and claimed membership',
  async (kind) => {
    const company = '01920000-0000-7000-8000-0000000000a0';
    const principal: Principal = {
      kind,
      userId: '01920000-0000-7000-8000-0000000000f1',
      companyId: company,
      deviceId: null,
      employeeId: null,
      grants: [],
      memberships: [{ companyId: company, scopeType: 'COMPANY', scopeId: company }],
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ principal, headers: { 'x-company-id': company } }),
      }),
    } as unknown as ExecutionContext;
    // Reject before database readiness/membership: principal type cannot borrow session authorization.
    await expect(new SelectedCompanyGuard(null).canActivate(context)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  },
);
