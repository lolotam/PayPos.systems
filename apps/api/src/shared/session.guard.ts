import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { resolveUserPrincipal, type AuthService, type Principal } from '@pospay/auth';
import { updateRequestContext } from '@pospay/observability';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { DEVICE_AUTHENTICATOR, type DeviceAuthenticator } from './device-authenticator.ts';
import { ApiError } from './errors.ts';
import { PUBLIC_ROUTE } from './public.decorator.ts';
import { toWebHeaders } from './web-headers.ts';

export const AUTH_SERVICE = Symbol('AUTH_SERVICE');

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the session guard on every non-public route; absent only on @Public() routes. */
    principal?: Principal;
    /** The company the session last selected — a hint the access guard re-verifies, never trusted as is. */
    companyHint?: string | null;
  }
}

/**
 * Deny by default (ADR-0003 §4): every route needs a verified session unless it is marked @Public(). The
 * principal is resolved server-side from the session cookie and attached to the request; what it may do is
 * decided by @Require (T9a-2), never by this guard.
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
    const authorization = request.headers.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Device ')) {
      return this.#device(request, authorization.slice('Device '.length));
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

  // ADR-0003 §4 path B: the token names its company and is proven inside it. A device principal carries no user and
  // no company role — only its branch; @Require routes, which need a user's membership, refuse it.
  async #device(request: FastifyRequest, token: string): Promise<boolean> {
    const device = this.#devices === null ? null : await this.#devices.authenticate(token);
    if (device === null) throw new ApiError('UNAUTHENTICATED');
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
