/**
 * Paths pino must never print (CLAUDE.md §8): PINs, passwords, tokens, secrets and credentials,
 * wherever they sit in a log object — top level, one level deep, or in request headers.
 * Extended as integrations arrive (gateway and messaging credentials — plan v4 T11).
 */
const SECRET_KEYS = [
  'pin',
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'credentials',
  'cookie',
  'authorization',
];

const PHONE_KEYS = ['phone', 'phoneNumber', 'mobile'];

const everywhere = (key: string): string[] => [key, `*.${key}`];

export const REDACTED_PATHS: readonly string[] = [
  ...SECRET_KEYS.flatMap(everywhere),
  ...PHONE_KEYS.flatMap(everywhere),
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
];

const PHONE_PATH = new RegExp(`(^|\\.)(${PHONE_KEYS.join('|')})$`);

/**
 * pino `redact.censor`: a phone number keeps its last 3 digits (CLAUDE.md §8), every other secret is
 * replaced entirely. Non-string phone values are replaced too — never printed as-is.
 *
 * @param value the value found at a redacted path
 * @param path  the path segments pino matched
 * @returns what is printed instead
 */
export function censor(value: unknown, path: readonly unknown[]): string {
  // pino can pass Symbol segments; String() converts them where an implicit join would throw.
  if (
    PHONE_PATH.test(path.map((segment) => String(segment)).join('.')) &&
    typeof value === 'string'
  ) {
    const digits = value.replace(/\D/g, '');
    return digits.length > 3 ? `***${digits.slice(-3)}` : '***';
  }
  return '[REDACTED]';
}
