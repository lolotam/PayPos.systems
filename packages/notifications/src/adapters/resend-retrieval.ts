import { request as httpsRequest } from 'node:https';
import type { IncomingMessage as HttpResponse } from 'node:http';
import { canonicalEmail } from '../email-identity.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The provider answers one sent email; anything bigger than this is refused instead of buffered.
const RESPONSE_LIMIT_BYTES = 65_536;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 10_000;
const HASH_BYTES = 32;

/** الوسوم الثلاثة التي يربطها محوّل الإرسال بكل إيميل (spec 075 FR-010). */
export interface RetrievedEmailTags {
  /** وسم الشركة — بريد الشركات بس. */
  readonly companyId: string | null;
  /** وسم الاعتماد — بريد الاسترجاع بس. */
  readonly authChallengeId: string | null;
  readonly attemptId: string;
  readonly executionId: string;
}

/** نتيجة استرجاع إيميل واحد: وسوم وبصمة، أو رفض، أو فشل قابل لإعادة المحاولة. */
export type ResendRetrievalResult =
  | {
      readonly kind: 'found';
      readonly id: string;
      readonly tags: RetrievedEmailTags;
      readonly recipientHash: Uint8Array;
      readonly hashKeyId: string;
    }
  | { readonly kind: 'invalid_tags'; readonly reason: 'RECIPIENT_INVALID' | 'TAGS_INVALID' }
  | { readonly kind: 'transient'; readonly code: string };

/** مسترجع الإيميل المرسل من المزود خارج أي معاملة قاعدة بيانات. */
export interface ResendEmailRetriever {
  retrieve(providerEmailId: string): Promise<ResendRetrievalResult>;
}

/** خيارات المسترجع: مفتاح العامل ودالة بصمة الوجهة وحدود الطلب. */
export interface ResendRetrievalOptions {
  readonly apiKey: string;
  readonly identify: (canonical: string) => { readonly hash: Uint8Array; readonly keyId: string };
  readonly timeoutMs?: number;
  readonly request?: typeof httpsRequest;
}

/** يبني مسترجعًا بأصل ثابت ومهلة وحجم استجابة محدودين دون إعادة محاولة داخلية. */
export function createResendEmailRetriever(options: ResendRetrievalOptions): ResendEmailRetriever {
  if (!options.apiKey || /[\r\n]/.test(options.apiKey))
    throw new Error('EMAIL_RETRIEVAL_KEY_INVALID');
  return new Retriever(options);
}

class Retriever implements ResendEmailRetriever {
  readonly #key: string;
  readonly #identify: ResendRetrievalOptions['identify'];
  readonly #request: typeof httpsRequest;
  readonly #timeoutMs: number;

  constructor(options: ResendRetrievalOptions) {
    this.#key = options.apiKey;
    this.#identify = options.identify;
    this.#request = options.request ?? httpsRequest;
    this.#timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    );
  }

  retrieve(providerEmailId: string): Promise<ResendRetrievalResult> {
    return new Promise((resolve) => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), this.#timeoutMs);
      const finish = (result: ResendRetrievalResult) => {
        clearTimeout(timer);
        resolve(result);
      };
      try {
        const req = this.#request(
          `https://api.resend.com/emails/${encodeURIComponent(providerEmailId)}`,
          {
            method: 'GET',
            signal: abort.signal,
            headers: { authorization: `Bearer ${this.#key}`, accept: 'application/json' },
          },
          (response) => this.#read(response, providerEmailId, finish),
        );
        req.on('error', () => finish({ kind: 'transient', code: 'NETWORK_UNKNOWN' }));
        req.end();
      } catch {
        finish({ kind: 'transient', code: 'NETWORK_UNKNOWN' });
      }
    });
  }

  #read(
    response: HttpResponse,
    providerEmailId: string,
    finish: (result: ResendRetrievalResult) => void,
  ): void {
    const status = response.statusCode ?? 0;
    // Anything but the sent email itself is retryable: the provider answers 404 for an id it does
    // not know yet, and the reconciliation must not quarantine a row for a temporary refusal.
    if (status !== 200) {
      response.destroy();
      finish({ kind: 'transient', code: `PROVIDER_${status}` });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    response.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > RESPONSE_LIMIT_BYTES) {
        response.destroy();
        finish({ kind: 'transient', code: 'RESPONSE_TOO_LARGE' });
        return;
      }
      chunks.push(chunk);
    });
    response.on('error', () => finish({ kind: 'transient', code: 'NETWORK_UNKNOWN' }));
    response.on('aborted', () => finish({ kind: 'transient', code: 'NETWORK_UNKNOWN' }));
    response.on('end', () => {
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        finish({ kind: 'transient', code: 'RESPONSE_INVALID' });
        return;
      }
      finish(decodePayload(payload, providerEmailId, this.#identify));
    });
  }
}

/** فك ترميز وثيقة رد المزود: يثبت الهوية والوسوم ويرفض أي بريد خام من الخروج. */
function decodePayload(
  payload: unknown,
  providerEmailId: string,
  identify: ResendRetrievalOptions['identify'],
): ResendRetrievalResult {
  if (typeof payload !== 'object' || payload === null)
    return { kind: 'transient', code: 'RESPONSE_INVALID' };
  const body = payload as { id?: unknown; to?: unknown; tags?: unknown };
  if (body.id !== providerEmailId) return { kind: 'invalid_tags', reason: 'TAGS_INVALID' };
  const recipient = singleRecipient(body.to);
  const canonical = recipient === null ? null : canonicalEmail(recipient);
  if (canonical === null) return { kind: 'invalid_tags', reason: 'RECIPIENT_INVALID' };
  let identity: { hash: Uint8Array; keyId: string };
  try {
    identity = identify(canonical);
  } catch {
    return { kind: 'transient', code: 'IDENTITY_UNAVAILABLE' };
  }
  if (identity.hash.length !== HASH_BYTES || identity.keyId.length === 0)
    return { kind: 'invalid_tags', reason: 'RECIPIENT_INVALID' };
  const tags = readTags(body.tags);
  if (tags === null) return { kind: 'invalid_tags', reason: 'TAGS_INVALID' };
  return {
    kind: 'found',
    id: providerEmailId,
    tags,
    recipientHash: identity.hash,
    hashKeyId: identity.keyId,
  };
}

function singleRecipient(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') return value[0];
  return null;
}

function readTags(value: unknown): RetrievedEmailTags | null {
  const entries = tagEntries(value);
  if (entries === null) return null;
  const attemptId = entries['attempt_id'];
  const executionId = entries['execution_id'];
  if (attemptId === undefined || executionId === undefined) return null;
  if (!UUID.test(attemptId) || !UUID.test(executionId)) return null;
  const companyId = entries['company_id'];
  if (companyId !== undefined) {
    if (!UUID.test(companyId)) return null;
    return { companyId, authChallengeId: null, attemptId, executionId };
  }
  // بريد الاعتماد بيتربّط بسجل الاعتماد: وسم الشركة غايب ووسم الاعتماد موجود.
  const authChallengeId = entries['auth_challenge_id'];
  if (authChallengeId === undefined || !UUID.test(authChallengeId)) return null;
  return { companyId: null, authChallengeId, attemptId, executionId };
}

function tagEntries(value: unknown): Record<string, string> | null {
  if (Array.isArray(value)) {
    const entries: Record<string, string> = {};
    for (const item of value) {
      if (typeof item !== 'object' || item === null) return null;
      const tag = item as { name?: unknown; value?: unknown };
      if (typeof tag.name !== 'string' || typeof tag.value !== 'string') return null;
      entries[tag.name] = tag.value;
    }
    return entries;
  }
  if (typeof value === 'object' && value !== null) {
    const entries: Record<string, string> = {};
    for (const [name, tag] of Object.entries(value as Record<string, unknown>)) {
      if (typeof tag !== 'string') return null;
      entries[name] = tag;
    }
    return entries;
  }
  return null;
}
