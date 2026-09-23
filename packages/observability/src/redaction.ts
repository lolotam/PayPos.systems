import { errorDiagnostic } from './serializers.ts';

// CLAUDE.md §8: never log PINs, tokens, credentials, or a full phone number (last 3 digits only).
// Keys are matched case-insensitively at ANY depth and inside arrays — pino's own `redact` paths only
// reach the levels they name, so a secret one level deeper than expected would be printed.
const SECRET_KEY =
  /^(pin|password|passwordhash|token|accesstoken|refreshtoken|idtoken|secret|clientsecret|apikey|x-api-key|credentials?|cookie|set-cookie|authorization)$/i;
const PHONE_KEY = /^(phone|phonenumber|mobile)$/i;

const MAX_DEPTH = 8;
export const REDACTED = '[REDACTED]';

/**
 * A phone number keeps its last 3 digits; anything else under a phone key is replaced entirely.
 *
 * @param value the value found under a phone key
 * @returns what is printed instead
 */
export function maskPhone(value: unknown): string {
  if (typeof value !== 'string') return REDACTED;
  const digits = value.replace(/\D/g, '');
  return digits.length > 3 ? `***${digits.slice(-3)}` : '***';
}

/**
 * Returns a copy of a log object with every secret replaced, at any depth and inside arrays. Cycles and
 * anything deeper than MAX_DEPTH are replaced rather than walked, so a hostile object cannot hang logging.
 *
 * @param value the object about to be logged
 * @returns a sanitised copy safe to write
 */
export function sanitize(value: unknown): unknown {
  const seen = new WeakSet<object>();
  const walk = (node: unknown, depth: number): unknown => {
    if (node === null || typeof node !== 'object') return node;
    // pino runs this before its serializers, so an Error anywhere in the object is reduced here — its
    // message, causes and extra properties can all carry secrets.
    if (node instanceof Error) return errorDiagnostic(node);
    if (seen.has(node)) return '[Circular]';
    if (depth >= MAX_DEPTH) return '[Truncated]';
    seen.add(node);
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      if (SECRET_KEY.test(key)) out[key] = REDACTED;
      else if (PHONE_KEY.test(key)) out[key] = maskPhone(child);
      else out[key] = walk(child, depth + 1);
    }
    return out;
  };
  return walk(value, 0);
}
