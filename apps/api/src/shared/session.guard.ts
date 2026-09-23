import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { resolveUserPrincipal, type AuthService, type Principal } from '@pospay/auth';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiError } from './errors.ts';
import { PUBLIC_ROUTE } from './public.decorator.ts';
import { toWebHeaders } from './web-headers.ts';

export const AUTH_SERVICE = Symbol('AUTH_SERVICE');

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the session guard on every non-public route; absent only on @Public() routes. */
    principal?: Principal;
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

  constructor(
    @Inject(Reflector) reflector: Reflector,
    @Inject(AUTH_SERVICE) auth: AuthService | null,
  ) {
    this.#reflector = reflector;
    this.#auth = auth;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.#reflector.getAllAndOverride<boolean | undefined>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    // No auth configured (a test app without it) means no session can exist — refused like any other.
    const resolved =
      this.#auth === null ? null : await resolveUserPrincipal(this.#auth, toWebHeaders(request));
    if (resolved === null) throw new ApiError('UNAUTHENTICATED');
    // A renewed session re-issues its cookie; dropped here, the browser would lose it at the old expiry.
    if (resolved.setCookies.length > 0) {
      void http.getResponse<FastifyReply>().header('set-cookie', [...resolved.setCookies]);
    }
    request.principal = resolved.principal;
    return true;
  }
}
