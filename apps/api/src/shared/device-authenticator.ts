/**
 * Proves a device token (ADR-0003 §4 path B) — identity implements it; the session guard only asks. It lives here
 * because the guard does, and no module may be imported by shared/.
 */
export interface DeviceAuthenticator {
  /**
   * @param token the token after "Device " in the Authorization header
   * @returns the device's company, id and branch, or null when the token proves nothing
   */
  authenticate(
    token: string,
  ): Promise<{ companyId: string; deviceId: string; branchId: string } | null>;
}

export const DEVICE_AUTHENTICATOR = Symbol('DEVICE_AUTHENTICATOR');
export const RATE_LIMITER = Symbol('RATE_LIMITER');
