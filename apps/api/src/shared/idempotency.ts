import { createHash } from 'node:crypto';

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { ApiError } from './errors.ts';

/**
 * What a write endpoint hands to its use case: the client's key and a fingerprint of the request, so
 * `runIdempotent` can tell a retry (same fingerprint → replay) from a reused key (different → 422).
 */
export interface IdempotencyInput {
  readonly key: string;
  readonly fingerprint: string;
}

const KEY = /^[!-~]{1,255}$/;

// Object keys sorted at every level: {"a":1,"b":2} and {"b":2,"a":1} are one request. Arrays keep their
// order, because order is part of what a client sends.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The fingerprint of one request: method, route pattern and canonical body, hashed. The route pattern,
 * not the URL, so a path parameter is compared through the body the use case actually receives.
 *
 * @param request method, route pattern and parsed body
 * @param request.method the HTTP method
 * @param request.route  the route pattern (`/v1/businesses`)
 * @param request.body   the parsed body
 * @returns sha256 hex
 */
export function requestFingerprint(request: {
  method: string;
  route: string;
  body: unknown;
}): string {
  return createHash('sha256')
    .update(canonicalJson([request.method.toUpperCase(), request.route, request.body ?? null]))
    .digest('hex');
}

/**
 * Reads and validates the `Idempotency-Key` header of a money- or stock-affecting endpoint
 * (CLAUDE.md §6). A missing or malformed key is a 400 before any work starts.
 */
export const Idempotency = createParamDecorator(
  (_data: unknown, context: ExecutionContext): IdempotencyInput => {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !KEY.test(key)) {
      throw new ApiError('IDEMPOTENCY_KEY_REQUIRED');
    }
    return {
      key,
      fingerprint: requestFingerprint({
        method: request.method,
        route: request.routeOptions.url ?? request.url,
        body: request.body,
      }),
    };
  },
);
