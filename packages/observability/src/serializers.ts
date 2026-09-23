/**
 * Log serializers. The defaults would print an error's message, its causes and every enumerable
 * property, and a request's full URL — each can carry a secret the key-based sanitizer cannot see
 * (`new Error('token=…')`, `/login?token=…`). These print only safe, structural facts.
 */

const MAX_FRAMES = 12;
const SAFE_NAME = /^[A-Z][A-Za-z]{0,40}Error$|^Error$/;
const SAFE_CODE = /^[A-Z0-9_]{1,32}$/;
const FRAME = /^at \S.*$/;

// V8 stacks start with `${name}: ${message}`. Frames are read only after that exact prefix, so a
// multiline message cannot pose as a frame; if the prefix is not there, no frame is trusted.
function framesOf(error: Error): string[] {
  const stack = error.stack ?? '';
  const header = error.message === '' ? error.name : `${error.name}: ${error.message}`;
  if (!stack.startsWith(header)) return [];
  return stack
    .slice(header.length)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => FRAME.test(line))
    .slice(0, MAX_FRAMES);
}

/**
 * An error as an allowlisted type, an allowlisted code and its stack frames — never the message, the
 * causes or any other property. A name or code outside the allowlist is dropped, not printed.
 *
 * @param error whatever was thrown
 * @returns a diagnostic safe to log
 */
export function errorDiagnostic(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: 'NonError' };
  const code = (error as { code?: unknown }).code;
  return {
    type: SAFE_NAME.test(error.name) ? error.name : 'Error',
    ...(typeof code === 'string' && SAFE_CODE.test(code) ? { code } : {}),
    frames: framesOf(error),
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
