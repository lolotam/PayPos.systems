import { createHmac, timingSafeEqual } from 'node:crypto';

// The window the signed timestamp may sit in, in seconds (spec 075 FR-002).
export const RESEND_TIMESTAMP_WINDOW_SECONDS = 300;
const EVENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const TIMESTAMP = /^\d{1,12}$/;
const SECRET_PREFIX = 'whsec_';
const MINIMUM_KEY_BYTES = 16;
const DOMAIN = 'pospay:notifications:resend-event:v1\0';

export interface ResendWebhookConfiguration {
  /** The signing secret of the Resend webhook; the only Resend credential the API holds. */
  readonly webhookSecret: string;
}

export interface ResendWebhookHeaders {
  readonly id: string | undefined;
  readonly timestamp: string | undefined;
  readonly signature: string | undefined;
}

/**
 * Reads the intake configuration from the environment. The API holds the webhook secret and nothing
 * else of the email group: no sending key and no recipient hash key (spec 075 FR-006).
 *
 * @param env the process environment
 * @returns the verified configuration
 */
export function readResendWebhookConfiguration(env: NodeJS.ProcessEnv): ResendWebhookConfiguration {
  const secret = env['RESEND_WEBHOOK_SECRET'];
  if (secret === undefined || secret.length === 0) throw new Error('RESEND_WEBHOOK_CONFIG_INVALID');
  resendSigningKey(secret);
  return { webhookSecret: secret };
}

/**
 * The HMAC key bytes of the signing secret: the part after the `whsec_` prefix, base64-decoded, as
 * the provider documents it.
 *
 * @param secret the webhook signing secret
 * @returns the decoded key bytes
 */
export function resendSigningKey(secret: string): Buffer {
  const raw = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length < MINIMUM_KEY_BYTES) throw new Error('RESEND_WEBHOOK_SECRET_INVALID');
  return bytes;
}

/**
 * Verifies the signature of a webhook request over the raw body. The signed content is
 * `<svix-id>.<svix-timestamp>.<raw body>` and every `v1` signature in the header is compared in
 * constant time; a timestamp outside the window is refused (spec 075 FR-002).
 *
 * @param body the raw request bytes
 * @param headers the three signature headers, each present exactly once
 * @param secret the webhook signing secret
 * @param now the current time, injected so the window is testable
 * @returns whether the request is authentic and fresh
 */
export function verifyResendSignature(
  body: Buffer,
  headers: ResendWebhookHeaders,
  secret: string,
  now: Date,
): boolean {
  const { id, timestamp, signature } = headers;
  if (typeof id !== 'string' || !EVENT_ID.test(id)) return false;
  if (typeof timestamp !== 'string' || !TIMESTAMP.test(timestamp)) return false;
  if (typeof signature !== 'string' || signature.length === 0) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds)) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - seconds) > RESEND_TIMESTAMP_WINDOW_SECONDS)
    return false;
  let expected: Buffer;
  try {
    expected = createHmac('sha256', resendSigningKey(secret))
      .update(`${id}.${timestamp}.`, 'utf8')
      .update(body)
      .digest();
  } catch {
    return false;
  }
  return signature.split(' ').some((entry) => {
    const separator = entry.indexOf(',');
    if (separator < 0) return false;
    if (entry.slice(0, separator) !== 'v1') return false;
    const provided = Buffer.from(entry.slice(separator + 1), 'base64');
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(expected, provided);
  });
}

/**
 * The permanent dedupe identity of a provider event: a domain-separated HMAC of the event id. It
 * survives the 30-day payload cleanup, so a replay after retention is still refused (spec 075 FR-004).
 *
 * @param key the digest key bytes
 * @param eventId the provider event id
 * @returns the 32-byte digest
 */
export function createResendEventDigest(key: Buffer) {
  return (eventId: string): Buffer =>
    createHmac('sha256', key).update(DOMAIN, 'utf8').update(eventId, 'utf8').digest();
}

/**
 * Normalises the provider bounce type into our own classification. Only a permanent bounce suppresses
 * the address; a transient one is evidence only, and an unknown value stays unknown so it can never
 * suppress by accident (owner decision ET-Q2).
 *
 * @param type the provider bounce type, if the event carries one
 * @returns the stored class, or null when the bounce is not classified
 */
export function resendBounceClass(type: string | undefined): 'PERMANENT' | 'TRANSIENT' | null {
  if (type === undefined) return null;
  const value = type.trim().toLowerCase();
  if (value === 'permanent') return 'PERMANENT';
  if (value === 'transient' || value === 'temporary') return 'TRANSIENT';
  return null;
}
