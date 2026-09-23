/**
 * Log serializers. The defaults would print an error's message, its causes and every enumerable
 * property, and a request's full URL — each can carry a secret the key-based sanitizer cannot see
 * (`new Error('token=…')`, `/login?token=…`). These print only safe, structural facts.
 */

const MAX_FRAMES = 12;

/**
 * An error as type, code and stack frames — never the message, never the causes, never other properties.
 * The first stack line repeats the message, so it is dropped too.
 *
 * @param error whatever was thrown
 * @returns a diagnostic safe to log
 */
export function errorDiagnostic(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error };
  const code = (error as { code?: unknown }).code;
  const frames = (error.stack ?? '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .slice(0, MAX_FRAMES);
  return {
    type: error.name,
    ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
    frames,
  };
}

interface LoggableRequest {
  method?: string;
  id?: string;
  routeOptions?: { url?: string };
}

/**
 * A request as its method and matched route pattern (`/v1/companies/:id`) — never the raw URL, whose
 * path segments and query string can carry tokens or phone numbers.
 *
 * @param request the Fastify request
 * @returns method, route pattern and request id
 */
export function requestDiagnostic(request: LoggableRequest | object): Record<string, unknown> {
  const { method, id, routeOptions } = request as LoggableRequest;
  return { method, route: routeOptions?.url ?? '[unmatched]', reqId: id };
}

/**
 * A response as its status code only — headers can carry `set-cookie`.
 *
 * @param reply the Fastify reply
 * @returns the status code
 */
export function responseDiagnostic(reply: object): Record<string, unknown> {
  return { statusCode: (reply as { statusCode?: number }).statusCode };
}
