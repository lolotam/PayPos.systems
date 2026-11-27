import { StaffAccessError } from '../../domain/errors.ts';
import type {
  GrantEmployeeAccessCommand,
  StaffAccessRole,
} from '../../ports/staff-access-begin.port.ts';
import type { GrantCommitScope } from '../../ports/staff-access-commit.port.ts';

/** نطاق الخطوة الثالثة بالقدر اللي تحتاجه فحوص السلطة فيه. */
type AuthorityScope = { authority(businessId: string, branchId: string): Promise<boolean> };

/** سلطة المانح على الفرع الأساسي — جوّه نفس معاملة الخطوة الثالثة (FR-F1-3). */
export async function assertPrimaryGrantAuthority(
  scope: AuthorityScope,
  employee: { readonly businessId: string; readonly primaryBranchId: string },
): Promise<void> {
  if (!(await scope.authority(employee.businessId, employee.primaryBranchId)))
    throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
}

/** سلطة المانح على كل فرع إضافي — جوّه نفس معاملة الخطوة الثالثة (080-b). */
export async function assertExtraGrantAuthority(
  scope: AuthorityScope,
  employee: { readonly businessId: string },
  extraBranches: readonly { readonly branchId: string }[],
): Promise<void> {
  for (const extra of extraBranches)
    if (!(await scope.authority(employee.businessId, extra.branchId)))
      throw new StaffAccessError('STAFF_ACCESS_NOT_ALLOWED');
}

/** عضوية الفرع الأساسي وعضويات الفروع الإضافية — كلها جوّه معاملة الخطوة الثالثة. */
export async function grantMemberships(
  scope: GrantCommitScope,
  command: GrantEmployeeAccessCommand,
  userId: string,
  employee: { readonly businessId: string },
  record: {
    readonly id: string;
    readonly branchId: string;
    readonly roleCode: StaffAccessRole;
    readonly operationId: string;
  },
  extraBranches: readonly {
    readonly id: string;
    readonly branchId: string;
    readonly roleCode: StaffAccessRole;
  }[],
): Promise<{
  primary: { membershipId: string };
  extras: readonly { membershipId: string; branchId: string; role: StaffAccessRole }[];
}> {
  const primary = await scope.grantMembership({
    operationId: record.operationId,
    userId,
    branchId: record.branchId,
    role: record.roleCode,
  });
  const extras = await scope.grantExtraMemberships({
    operationId: record.operationId,
    userId,
    recordId: record.id,
    businessId: employee.businessId,
    employeeId: command.employeeId,
    branches: extraBranches,
  });
  return { primary, extras };
}

/**
 * استثناءات الصلاحية المضمّنة (080-b): بتتكتب على العضوية الأساسية أو على أقرب فرع زي ما
 * ترتّبهم قواعد identity. أول استثناء مرفوض بيرمي من جوّه المعاملة فترجع كل الكتابة.
 */
export async function applyGrantOverrides(
  scope: GrantCommitScope,
  command: GrantEmployeeAccessCommand,
  granted: {
    membershipId: string;
    branchId: string;
    role: StaffAccessRole;
    extras: readonly { membershipId: string; branchId: string; role: StaffAccessRole }[];
  },
): Promise<void> {
  const overrides = command.permissionOverrides ?? [];
  if (overrides.length === 0) return;
  await scope.applyOverrides({
    memberships: [
      { membershipId: granted.membershipId, branchId: granted.branchId, role: granted.role },
      ...granted.extras,
    ],
    overrides,
  });
}
