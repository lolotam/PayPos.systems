import { evaluateAccess, type AccessTarget } from '../../domain/access.ts';
import type {
  AccessReader,
  ActiveMembership,
  SourcedGrant,
} from '../../ports/access-reader.port.ts';

/**
 * What the route asks for, as the request carried it — nothing here is trusted yet.
 */
export interface AuthorizeRequestInput {
  readonly userId: string;
  /** The x-company-id header, or the session hint when the header is absent. */
  readonly requestedCompany: unknown;
  readonly permission: string;
  /** The raw route parameter values naming the target, when the permission's scope needs one. */
  readonly businessParam?: unknown;
  readonly branchParam?: unknown;
}

export interface Authorized {
  readonly companyId: string;
  readonly memberships: readonly ActiveMembership[];
  readonly grants: readonly SourcedGrant[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Anything that is not one well-formed UUID is refused as if it were not the caller's — never an oracle.
const asUuid = (value: unknown): string | null =>
  typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;

// Authorizes one request for a user (ADR-0003 §4, path A): company membership first, then the permission at the target.
export class AuthorizeRequest {
  readonly #reader: AccessReader;

  constructor(reader: AccessReader) {
    this.#reader = reader;
  }

  /**
   * @param input the user, the requested company and the route's permission and target parameters
   * @returns the verified company with its memberships and grants, or null when the request is refused
   */
  async execute(input: AuthorizeRequestInput): Promise<Authorized | null> {
    const companyId = asUuid(input.requestedCompany);
    if (companyId === null) return null;
    // Refused before any tenant is entered: the membership list is read under withUser only.
    if (!(await this.#reader.companiesOf(input.userId)).includes(companyId)) return null;
    const target = await this.#target(companyId, input);
    if (target === null) return null;
    const access = await this.#reader.accessIn(companyId, input.userId);
    if (!evaluateAccess(access.grants, input.permission, target)) return null;
    return { companyId, memberships: access.memberships, grants: access.grants };
  }

  async #target(companyId: string, input: AuthorizeRequestInput): Promise<AccessTarget | null> {
    if (input.branchParam !== undefined) {
      const branchId = asUuid(input.branchParam);
      if (branchId === null) return null;
      // The branch's business comes from the database, inside the verified company — never from the client.
      const businessId = await this.#reader.businessOfBranch(companyId, branchId);
      return businessId === null ? null : { companyId, businessId, branchId };
    }
    if (input.businessParam !== undefined) {
      const businessId = asUuid(input.businessParam);
      if (businessId === null) return null;
      // Another company's business, or an unknown one, is refused here — the same 403 as no permission.
      return (await this.#reader.businessInCompany(companyId, businessId))
        ? { companyId, businessId }
        : null;
    }
    return { companyId };
  }
}
