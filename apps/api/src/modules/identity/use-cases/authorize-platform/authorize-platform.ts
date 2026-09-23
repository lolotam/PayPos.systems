/**
 * One grant as the principal carries it — only the fields this decision reads.
 */
export interface PrincipalGrant {
  readonly permission: string;
  readonly effect: 'ALLOW' | 'DENY';
  readonly source: string;
}

// Authorizes a platform-level route (ADR-0003 §3): a platform grant, never a company role or override, opens it.
export class AuthorizePlatform {
  /**
   * @param grants     the principal's grants, filled from platform_grants by the session guard
   * @param permission the route's platform permission
   * @returns true when an active platform grant allows it
   */
  execute(grants: readonly PrincipalGrant[], permission: string): boolean {
    return grants.some(
      (g) => g.source === 'platform' && g.permission === permission && g.effect === 'ALLOW',
    );
  }
}
