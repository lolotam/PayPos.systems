import type { FastifyRequest } from 'fastify';

import { ApiError } from './errors.ts';

/**
 * The verified company and user of a request that passed @Require — never anything the client sent.
 *
 * @param request the request the access guard authorized
 * @returns the company and user ids
 */
export function actorOf(request: FastifyRequest): { companyId: string; userId: string } {
  const companyId = request.principal?.companyId;
  const userId = request.principal?.userId;
  // Only reachable if a route skipped @Require — createApp refuses to start with one, so this is a safety net.
  if (companyId === null || companyId === undefined || userId === null || userId === undefined) {
    throw new ApiError('FORBIDDEN');
  }
  return { companyId, userId };
}
