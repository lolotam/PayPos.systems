import { expect, it } from 'vitest';
import { personalBranches } from './personal-branches.js';
import { personalBranchesPaths } from './personal-branches-openapi.js';
const branch = {
  id: '00000000-0000-4000-8000-000000000001',
  name_ar: null,
  name_en: 'Synthetic branch',
  timezone: 'Asia/Kuwait',
};
it('keeps the discovery projection strict and advertises personal authentication only', () => {
  expect(personalBranches.parse({ items: [branch] })).toEqual({ items: [branch] });
  expect(
    personalBranches.safeParse({ items: [{ ...branch, employee_id: branch.id }] }).success,
  ).toBe(false);
  expect(personalBranchesPaths['/v1/staff/me/branches'].get.security).toEqual([
    { PersonalStaffSession: [] },
  ]);
  expect(personalBranchesPaths['/v1/staff/me/branches'].get.responses['503']).toEqual({
    description: 'NOT_READY',
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
    },
  });
});
