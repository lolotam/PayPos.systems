import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  resolveUserPrincipal,
  type AuthService,
  type Principal,
  type StaffSessions,
} from '@pospay/auth';
import { updateRequestContext } from '@pospay/observability';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  DEVICE_AUTHENTICATOR,
  RATE_LIMITER,
  type DeviceAuthenticator,
} from './device-authenticator.ts';
import { ApiError } from './errors.ts';
import {
  PERSONAL_AUTHENTICATION,
  PERSONAL_ROUTE,
  type PersonalAuthentication,
} from './personal-authentication.ts';
import { personalSessionRequest } from './personal-session.guard.ts';
import type { RateLimiter } from './ports/rate-limiter.port.ts';
import { PUBLIC_ROUTE } from './public.decorator.ts';
import { SIGN_OUT_ROUTE, signOutRequest } from './sign-out.guard.ts';
import { STAFF_POS_ORIGIN, type StaffOrigins } from './staff-origin.token.ts';
import { STAFF_SESSIONS } from './staff-sessions.token.ts';
import { toWebHeaders } from './web-headers.ts';
import {
  STAFF_AUTHENTICATION,
  STAFF_ROUTE,
  type StaffAuthentication,
} from './staff-authentication.ts';

export const AUTH_SERVICE = Symbol('AUTH_SERVICE');

// ADR-0019: only the staff OTP request may proceed when the device token is real and its company is
// soft-deleted. Every other device route refuses it exactly like an unknown token. The allow-list is
// this metadata, set by AllowClosedCompanyDeviceOtp, never a match on the URL.
export const CLOSED_COMPANY_DEVICE_OTP = Symbol('CLOSED_COMPANY_DEVICE_OTP');
export const AllowClosedCompanyDeviceOtp = (): MethodDecorator =>
  SetMetadata(CLOSED_COMPANY_DEVICE_OTP, true);

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Set by the session guard on every non-public route; absent on @Public() routes and on the two
     * sign-out routes (SignOutRoute), which carry none (spec 067 D-7).
     */
    principal?: Principal;
    /** The company the session last selected — a hint the access guard re-verifies, never trusted as is. */
    companyHint?: string | null;
  }
}

/**
 * Deny by default (ADR-0003 §4): every route needs a verified session unless it is marked @Public(). The
 * principal is resolved server-side from the session cookie and attached to the request; what it may do is
 * decided by @Require (T9a-2), never by this guard. The two sign-out routes (SignOutRoute) are the
 * session-optional exception: they read the signed cookie alone and set no principal (spec 067 D-1).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  readonly #reflector: Reflector;
  readonly #auth: AuthService | null;
  readonly #devices: DeviceAuthenticator | null;

  constructor(
    @Inject(Reflector) reflector: Reflector,
    @Inject(AUTH_SERVICE) auth: AuthService | null,
    @Inject(DEVICE_AUTHENTICATOR) devices: DeviceAuthenticator | null,
    @Inject(STAFF_AUTHENTICATION) private readonly staff: StaffAuthentication | null,
    @Inject(PERSONAL_AUTHENTICATION) private readonly personal: PersonalAuthentication | null,
    @Inject(STAFF_SESSIONS) private readonly staffSessions: StaffSessions | null,
    @Inject(STAFF_POS_ORIGIN) private readonly staffOrigin: StaffOrigins | null,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter | null,
  ) {
    this.#reflector = reflector;
    this.#auth = auth;
    this.#devices = devices;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.#reflector.getAllAndOverride<boolean | undefined>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const signOut = this.#reflector.get<'staff' | 'personal' | undefined>(
      SIGN_OUT_ROUTE,
      context.getHandler(),
    );
    if (signOut !== undefined) return this.#signOut(request, signOut);
    const personalPolicy = this.#reflector.get<boolean | 'staff'>(
      PERSONAL_ROUTE,
      context.getHandler(),
    );
    if (
      personalPolicy === true ||
      (personalPolicy === 'staff' && request.headers.authorization === undefined)
    )
      return personalSessionRequest(request, this.personal);
    // The scheme is case-insensitive (RFC 9110 §11.1): `device <token>` must never fall back to a cookie session.
    const authorization = request.headers.authorization ?? '';
    const policy = this.#reflector.get<'device' | 'staff' | undefined>(
      STAFF_ROUTE,
      context.getHandler(),
    );
    const allowClosedCompany =
      this.#reflector.get<true | undefined>(CLOSED_COMPANY_DEVICE_OTP, context.getHandler()) ===
      true;
    if (policy !== undefined)
      return this.#staff(request, authorization, policy, allowClosedCompany);
    if (/^device(\s|$)/i.test(authorization)) {
      return this.#device(request, authorization.slice('device'.length).trim(), allowClosedCompany);
    }
    // No auth configured (a test app without it) means no session can exist — refused like any other.
    const resolved =
      this.#auth === null ? null : await resolveUserPrincipal(this.#auth, toWebHeaders(request));
    if (resolved === null) throw new ApiError('UNAUTHENTICATED');
    // A renewed session re-issues its cookie; dropped here, the browser would lose it at the old expiry.
    if (resolved.setCookies.length > 0) {
      void http.getResponse<FastifyReply>().header('set-cookie', [...resolved.setCookies]);
    }
    request.principal = resolved.principal;
    if (resolved.principal.userId !== null)
      updateRequestContext({ userId: resolved.principal.userId });
    request.companyHint = resolved.companyHint;
    return true;
  }

  // The sign-out policy runs before every session read: the route proves nothing but the signed cookie,
  // so no principal is set and no device, eligibility or binding code is consulted (spec 067 D-1).
  async #signOut(request: FastifyRequest, kind: 'staff' | 'personal'): Promise<boolean> {
    return signOutRequest(request, kind, {
      staffSessions: this.staffSessions,
      staffOrigin: this.staffOrigin,
      personal: this.personal,
      limiter: this.limiter,
    });
  }

  async #staff(
    request: FastifyRequest,
    authorization: string,
    policy: 'device' | 'staff',
    allowClosedCompany: boolean,
  ): Promise<boolean> {
    if (!/^device\s/i.test(authorization)) throw new ApiError('UNAUTHENTICATED');
    await this.#device(request, authorization.slice('device'.length).trim(), allowClosedCompany);
    const principal = request.principal;
    const branchId = principal?.memberships[0]?.scopeId;
    if (
      principal?.companyId === null ||
      principal?.companyId === undefined ||
      principal.deviceId === null ||
      branchId === undefined
    )
      throw new ApiError('UNAUTHENTICATED');
    const device =
      this.staff === null
        ? null
        : await this.staff.context({
            companyId: principal.companyId,
            deviceId: principal.deviceId,
            branchId,
          });
    if (device === null) throw new ApiError('UNAUTHENTICATED');
    request.staffDevice = device;
    if (policy === 'device') return true;
    const session = await this.#auth?.staff.resolve(toWebHeaders(request), device);
    if (
      session === null ||
      session === undefined ||
      this.staff === null ||
      !(await this.staff.eligible(session.userId, device))
    )
      throw new ApiError('UNAUTHENTICATED');
    request.staffSession = session;
    request.principal = { ...principal, userId: session.userId, grants: [] };
    updateRequestContext({ userId: session.userId });
    return true;
  }

  // ADR-0003 §4 path B: the token names its company and is proven inside it. A device principal carries no user and
  // no company role — only its branch; @Require routes, which need a user's membership, refuse it.
  async #device(
    request: FastifyRequest,
    token: string,
    allowClosedCompany: boolean,
  ): Promise<boolean> {
    const device = this.#devices === null ? null : await this.#devices.authenticate(token);
    // شركة مقفولة مش سر يتكشف: نفس رفض التوكن المجهول، إلا طلب OTP اللي ADR-0019 ثبّت ردّه 202.
    if (device === null || (device.companyActive === false && !allowClosedCompany)) {
      throw new ApiError('UNAUTHENTICATED');
    }
    request.principal = {
      kind: 'device',
      userId: null,
      employeeId: null,
      companyId: device.companyId,
      deviceId: device.deviceId,
      memberships: [{ companyId: device.companyId, scopeType: 'BRANCH', scopeId: device.branchId }],
      grants: [],
    };
    updateRequestContext({ companyId: device.companyId, branchId: device.branchId });
    return true;
  }
}
