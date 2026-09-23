import type { FastifyRequest } from 'fastify';

/**
 * Fastify's parsed headers as the Web `Headers` Better Auth reads.
 *
 * @param request the Fastify request
 * @returns the same headers, repeated values joined
 */
export function toWebHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  return headers;
}
