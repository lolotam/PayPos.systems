import { permissionPossessionFailure } from '../../domain/permission-edit.ts';
import type {
  AccessReader,
  ActiveMembership,
  SourcedGrant,
  AccessTargetRequest,
  AccessFeature,
  BranchRequestAccess,
} from '../../ports/access-reader.port.ts';

/**
 * What the route asks for, as the request carried it — nothing here is trusted yet.
 */
export interface AuthorizeRequestInput {
  readonly userId: string;
  /** The x-company-id header, or the session hint when the header is absent. */
  readonly requestedCompany: unknown;
  /** One permission, or the list of permissions that may open the route — one of them is enough (TD-13). */
  readonly permission: string | readonly string[];
  /** The raw route parameter values naming the target, when the permission's scope needs one. */
  readonly businessParam?: unknown;
  readonly branchParam?: unknown;
  readonly membershipParam?: unknown;
  readonly featureFlag?: string;
}

export interface Authorized {
  readonly feature?: AccessFeature;
  readonly companyId: string;
  readonly memberships: readonly ActiveMembership[];
  readonly grants: readonly SourcedGrant[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Anything that is not one well-formed UUID is refused as if it were not the caller's — never an oracle.
const asUuid = (value: unknown): string | null =>
  typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;

// Authorizes one request for a user (ADR-0003 §4, path A): company membership first, then one of the route's
// permissions at the target.
export class AuthorizeRequest implements BranchRequestAccess {
  readonly #reader: AccessReader;

  constructor(reader: AccessReader) {
    this.#reader = reader;
  }

  /**
   * @param input the user, the requested company and the route's permission(s) and target parameters
   * @returns the verified company with its memberships and grants, or null when the request is refused
   */
  async execute(input: AuthorizeRequestInput): Promise<Authorized | null> {
    const companyId = asUuid(input.requestedCompany);
    if (companyId === null) return null;
    // Refused before any tenant is entered: the membership list is read under withUser only.
    if (!(await this.#reader.companiesOf(input.userId)).includes(companyId)) return null;
    const request = this.#target(input);
    if (request === null) return null;
    const inspected = await this.#reader.accessAt(
      companyId,
      input.userId,
      request,
      input.featureFlag,
    );
    if (inspected === null) return null;
    const { targets, access } = inspected;
    // فحص التوابع هنا يسبق Zod؛ الجسم غير الصحيح لا يكشف عضوية ممنوعة بـ DENY في فرع تابع.
    // المنح بتتقري مرة واحدة في معاملة واحدة، مهما كان عدد الصلاحيات المقبولة.
    const permissions: readonly string[] =
      typeof input.permission === 'string' ? [input.permission] : input.permission;
    const granted = permissions.some(
      (permission) =>
        permissionPossessionFailure(
          access.grants,
          permission,
          targets.target,
          targets.descendantTargets,
        ) === null,
    );
    if (!granted) return null;
    return {
      companyId,
      memberships: access.memberships,
      grants: access.grants,
      ...(inspected.feature === undefined ? {} : { feature: inspected.feature }),
    };
  }

  /** يفوّض فروع الصفحة بنفس تقييم الطلب المفرد بعد تأكيد الشركة مرة واحدة وقراءة المنح مرة واحدة. */
  async executeBranches(
    input: Parameters<BranchRequestAccess['executeBranches']>[0],
  ): ReturnType<BranchRequestAccess['executeBranches']> {
    const allowed = new Map<string, boolean>();
    const branchIds = [...new Set(input.branchParams.map(asUuid).filter((id) => id !== null))];
    for (const branchId of branchIds) allowed.set(branchId, false);
    const companyId = asUuid(input.requestedCompany);
    if (companyId === null || branchIds.length === 0) return allowed;
    if (!(await this.#reader.companiesOf(input.userId)).includes(companyId)) return allowed;
    const inspected = await this.#reader.accessAtBranches(companyId, input.userId, branchIds);
    if (inspected === null) return allowed;
    const { businesses, access } = inspected;
    for (const [branchId, businessId] of businesses) {
      allowed.set(
        branchId,
        permissionPossessionFailure(
          access.grants,
          input.permission,
          { companyId, businessId, branchId },
          [],
        ) === null,
      );
    }
    return allowed;
  }

  #target(input: AuthorizeRequestInput): AccessTargetRequest | null {
    if (input.membershipParam !== undefined) {
      const membershipId = asUuid(input.membershipParam);
      return membershipId === null ? null : { kind: 'membership', membershipId };
    }
    if (input.branchParam !== undefined) {
      const branchId = asUuid(input.branchParam);
      return branchId === null ? null : { kind: 'branch', branchId };
    }
    if (input.businessParam !== undefined) {
      const businessId = asUuid(input.businessParam);
      return businessId === null ? null : { kind: 'business', businessId };
    }
    return { kind: 'company' };
  }
}
