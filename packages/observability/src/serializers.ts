/**
 * Log serializers. The defaults would print an error's message, its causes and every enumerable
 * property, and a request's full URL — each can carry a secret the key-based sanitizer cannot see
 * (`new Error('token=…')`, `/login?token=…`). These print only safe, structural facts.
 */

const MAX_FRAMES = 12;

// Names are printed only if they are on this list; anything else becomes "Error".
const KNOWN_NAMES = new Set([
  'Error',
  'AggregateError',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'AbortError',
  'TimeoutError',
  'ApiError',
  'PostgresError',
  'ZodError',
  'HttpException',
  'NotFoundException',
  'BadRequestException',
]);

// Codes are printed only in two recognised shapes: Node system codes (ECONNREFUSED) and Fastify codes
// (FST_ERR_…). All-digit values are never printed — a PIN or a phone number would fit a looser rule.
const KNOWN_CODE = /^E[A-Z]{2,20}$|^FST_ERR_[A-Z_]{1,40}$/;

// A frame must look like a real V8 frame — `at fn (path:line:col)` or `at path:line:col` — with a file
// path. The stack's text is not trusted just for following the message: `.message` can change after
// `.stack` was captured, so a line is kept only if its own shape proves it is a frame.
const FRAME =
  /^at (?:[\w$.<>[\] ]{1,120} \()?(?:file:\/\/\/|node:|[A-Za-z]:[\\/]|\/)[^\s()]{1,300}:\d+:\d+\)?$/;

function framesOf(error: Error): string[] {
  return (error.stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => FRAME.test(line))
    .slice(0, MAX_FRAMES);
}

/**
 * Any thrown value as a recognised type, a recognised code and its verified stack frames — never the
 * message, the causes or any other property. A non-Error (a thrown string or object) is reduced to a
 * fixed label: its content is never printed.
 *
 * @param error whatever was thrown
 * @returns a diagnostic safe to log
 */
export function errorDiagnostic(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: 'NonError' };
  const code = (error as { code?: unknown }).code;
  return {
    type: KNOWN_NAMES.has(error.name) ? error.name : 'Error',
    ...(typeof code === 'string' && KNOWN_CODE.test(code) ? { code } : {}),
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
