import { errorDiagnostic } from './serializers.ts';

// CLAUDE.md §8: never log PINs, tokens, credentials, or a full phone number (last 3 digits only).
// Keys are matched case-insensitively at ANY depth and inside arrays — pino's own `redact` paths only
// reach the levels they name, so a secret one level deeper than expected would be printed.
// Keys are compared after removing case and separators, so accessToken, access_token and ACCESS-TOKEN are
// one key, and by suffix, so sessionToken, bearer_token or card_cvv are caught without being listed.
const SECRET_SUFFIXES = [
  'token',
  'secret',
  'password',
  'passwordhash',
  'apikey',
  'credential',
  'credentials',
  'cookie',
  'authorization',
  'pin',
  'otp',
  'cvv',
  // a hash of a secret (pin_hash, token_hash, password_hash) is still sensitive
  'hash',
  // any key ending in "key" is a credential (secret_key, hmac_key, merchant_key, a bare key) unless it is
  // one of the structural names below — enumerating credential prefixes always misses the next one
  'key',
  'passphrase',
  // a connection string carries its password inline
  'dsn',
  // presigned-URL and webhook signatures (X-Amz-Signature, sig)
  'signature',
  'connectionstring',
];
const STRUCTURAL_KEYS = new Set([
  'sortkey',
  'cachekey',
  'primarykey',
  'foreignkey',
  'partitionkey',
  'groupkey',
  'lookupkey',
  'routekey',
  'eventkey',
  'messagekey',
  'translationkey',
  'i18nkey',
]);
const PHONE_SUFFIXES = ['phone', 'phones', 'phonenumber', 'phonenumbers', 'mobile', 'mobiles'];
const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');
// A plural container ("passwords", "tokens", "hashes") holds secrets under ordinary child keys, so the key
// is also tested with a trailing "s" or "es" removed — the container is redacted before its children.
const endsWithAny = (key: string, suffixes: readonly string[]): boolean => {
  const normalized = normalizeKey(key);
  const forms = [normalized, normalized.replace(/es$/, ''), normalized.replace(/s$/, '')];
  return forms.some((form) => suffixes.some((suffix) => form.endsWith(suffix)));
};
const isSecretKey = (key: string): boolean =>
  endsWithAny(key, SECRET_SUFFIXES) && !STRUCTURAL_KEYS.has(normalizeKey(key));
const isPhoneKey = (key: string): boolean => endsWithAny(key, PHONE_SUFFIXES);

// URLs are checked in every string value, because their key (DATABASE_URL, url, link) looks harmless. A URL
// is PARSED, not pattern-matched: the parser knows that the last "@" before the host ends the userinfo (a
// password may contain "@"). Only scheme, host and port survive; userinfo, path, query and fragment are
// withheld: a reset link carries its token in the path, an OAuth callback in the fragment, an SMS webhook a
// phone number in the query (even a bare `?token`), and no name or pattern tells those from harmless ones.
const URL_START = /^\s*[a-z][a-z0-9+.-]*:\/\//i;
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;

function scrubUrl(candidate: string): string {
  try {
    const url = new URL(candidate);
    const userinfo = url.username !== '' || url.password !== '' ? '***@' : '';
    const path = url.pathname === '' || url.pathname === '/' ? url.pathname : '/[REDACTED]';
    const query = url.search === '' ? '' : '?[REDACTED]';
    const fragment = url.hash === '' ? '' : '#[REDACTED]';
    return `${url.protocol}//${userinfo}${url.host}${path}${query}${fragment}`;
  } catch {
    // Unparseable: no pattern can tell where its userinfo ends, so only the scheme survives.
    return candidate.replace(/^(\s*[a-z][a-z0-9+.-]*:\/\/)[\s\S]*$/i, '$1[REDACTED]');
  }
}

// A value that IS a URL is parsed whole (a password may even contain whitespace). A URL embedded in longer
// text is found and parsed on its own — but in text its end is a guess: "postgres://user:with space@db" is
// matched only up to the space. If an "@" still follows a "://" once every parsed userinfo is masked, the
// boundary was ambiguous and the whole value is withheld.
const AMBIGUOUS_USERINFO = /:\/\/[\s\S]*@/;
function scrubUrlCredentials(text: string): string {
  if (URL_START.test(text)) return scrubUrl(text.trim());
  const scrubbed = text.replace(URL_IN_TEXT, scrubUrl);
  return AMBIGUOUS_USERINFO.test(scrubbed.replaceAll('://***@', '://')) ? '[REDACTED]' : scrubbed;
}

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
  // Already masked (the sanitiser can run twice on one line): keep it, don't mask the mask.
  if (/^\*{3}\d{0,3}$/.test(value)) return value;
  const digits = value.replace(/\D/g, '');
  return digits.length > 3 ? `***${digits.slice(-3)}` : '***';
}

// One walk for both entry points. Only data survives: functions (including a `toJSON` hook, which JSON
// serialisation would call and which could return anything) are dropped, dates become ISO strings, errors
// become diagnostics. Cycles and anything deeper than MAX_DEPTH are replaced rather than walked.
function scrub(value: unknown, maskPhones: boolean): unknown {
  const seen = new WeakSet<object>();
  const walk = (node: unknown, depth: number): unknown => {
    if (typeof node === 'function' || typeof node === 'symbol') return undefined;
    if (typeof node === 'bigint') return node.toString();
    if (typeof node === 'string') return scrubUrlCredentials(node);
    if (node === null || typeof node !== 'object') return node;
    if (node instanceof Date) return Number.isNaN(node.getTime()) ? null : node.toISOString();
    // pino runs this before its serializers, so an Error anywhere in the object is reduced here — its
    // message, causes and extra properties can all carry secrets.
    if (node instanceof Error) return errorDiagnostic(node);
    if (seen.has(node)) return '[Circular]';
    if (depth >= MAX_DEPTH) return '[Truncated]';
    seen.add(node);
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      if (typeof child === 'function') continue;
      if (isSecretKey(key)) out[key] = REDACTED;
      else if (maskPhones && isPhoneKey(key))
        out[key] = Array.isArray(child) ? child.map(maskPhone) : maskPhone(child);
      else out[key] = walk(child, depth + 1);
    }
    return out;
  };
  return walk(value, 0);
}

/**
 * Returns an inert copy of a log object with every secret replaced, at any depth and inside arrays, and
 * every phone number reduced to its last 3 digits (CLAUDE.md §8).
 *
 * @param value the object about to be logged
 * @returns a sanitised copy safe to write
 */
export function sanitize(value: unknown): unknown {
  return scrub(value, true);
}

/**
 * The same walk for a business record that is kept, not a technical log: secrets and URL credentials are
 * replaced, phone numbers are kept as they are. Used for the audit trail's before/after snapshots.
 *
 * @param value the snapshot about to be stored
 * @returns a copy with no secret in it
 */
export function redactSecrets(value: unknown): unknown {
  return scrub(value, false);
}
