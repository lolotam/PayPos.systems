import { expect, it } from 'vitest';
import { ownLeaveBranchQuery, ownLeaveListQuery } from '../staff/leave.js';
import { buildOpenApiDocument } from '../openapi.js';
import { leavePaths } from '../staff/leave-openapi.js';

it('keeps employee/workspace identity out of own queries and validates the selected branch', () => {
  const branch_id = '01920000-0000-7000-8000-000000000001';
  expect(ownLeaveBranchQuery.parse({ branch_id })).toEqual({ branch_id });
  expect(ownLeaveBranchQuery.parse({})).toEqual({});
  expect(ownLeaveListQuery.parse({ branch_id })).toEqual({ branch_id, limit: 20 });
  for (const schema of [ownLeaveBranchQuery, ownLeaveListQuery]) {
    expect(schema.safeParse({ branch_id: 'invalid' }).success).toBe(false);
    for (const field of ['employee_id', 'business_id', 'company_id'])
      expect(schema.safeParse({ branch_id, [field]: branch_id }).success).toBe(false);
  }
});

it('documents personal-cookie OR paired kiosk-cookie-plus-Device security for all own leave operations', () => {
  const doc = buildOpenApiDocument();
  const own = leavePaths['/v1/staff/me/leave-requests'];
  const cancel = leavePaths['/v1/staff/me/leave-requests/{leaveId}/cancel'];
  for (const operation of [own.get, own.post, cancel.post]) {
    expect(operation.security).toEqual([
      { PersonalStaffSession: [] },
      { KioskStaffSession: [], DeviceToken: [] },
    ]);
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Origin', required: true }),
        expect.objectContaining({ name: 'Authorization', required: false }),
        expect.objectContaining({ name: 'branch_id', in: 'query' }),
      ]),
    );
  }
  expect(doc).toMatchObject({
    components: {
      securitySchemes: {
        PersonalStaffSession: { in: 'cookie', name: 'pospay-personal.session_token' },
        KioskStaffSession: { in: 'cookie', name: 'pospay-staff.session_token' },
      },
    },
  });
});
