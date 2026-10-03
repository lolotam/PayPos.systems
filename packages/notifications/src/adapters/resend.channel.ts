import { request as httpsRequest } from 'node:https';
import type { IncomingMessage as HttpResponse } from 'node:http';
import type { Channel, ChannelResult } from '../channel.ts';
import type { EmailRequest } from '../email-request.ts';
import { canonicalEmail } from '../email-identity.ts';
import { renderOperationalEmail } from '../templates/email-operational.ts';

export interface ResendOptions {
  readonly now: () => Date;
  readonly env?: NodeJS.ProcessEnv;
  readonly request?: typeof httpsRequest;
  readonly timeoutMs?: number;
}
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unknown = (code: 'NETWORK_UNKNOWN' | 'RESPONSE_INVALID' | 'PROVIDER_5XX'): ChannelResult => ({
  kind: 'unknown',
  code,
  outcomeKnown: false,
});

export class ResendChannel implements Channel<EmailRequest> {
  readonly #key: string;
  readonly #from: string;
  readonly #replyTo: string;
  readonly #adminOrigin: string;
  readonly #request: typeof httpsRequest;
  readonly #now: () => Date;
  readonly #timeoutMs: number;

  constructor(options: ResendOptions) {
    const env = options.env ?? process.env;
    const mailbox = env['EMAIL_FROM_ADDRESS'] ?? '';
    const name = env['EMAIL_FROM_NAME'] ?? '';
    const replyTo = env['EMAIL_REPLY_TO'] ?? '';
    const key = env['RESEND_API_KEY'] ?? '';
    const adminOrigin = env['EMAIL_ADMIN_ORIGIN'] ?? '';
    if (
      !key ||
      /[\r\n]/.test(key) ||
      canonicalEmail(mailbox) !== mailbox ||
      !mailbox.endsWith('@send.pospay.systems') ||
      !name ||
      /[\r\n<>]/.test(name) ||
      canonicalEmail(replyTo) !== replyTo ||
      !replyTo ||
      renderOperationalEmail('document_expiring', 1, 'en', [], adminOrigin) === null
    )
      throw new Error('EMAIL_PROVIDER_CONFIG_INVALID');
    // TODO(spec): المالك يحدد mailbox/display name وReply-To المراقب ومشغل feedback قبل التفعيل.
    this.#key = key;
    this.#from = `${name} <${mailbox}>`;
    this.#replyTo = replyTo;
    this.#adminOrigin = adminOrigin;
    this.#request = options.request ?? httpsRequest;
    this.#now = options.now;
    this.#timeoutMs = Math.min(10_000, Math.max(1, options.timeoutMs ?? 10_000));
  }

  async send(input: EmailRequest): Promise<ChannelResult> {
    return this.submit(this.body(input), input.deadline);
  }

  private body(input: EmailRequest): string {
    const content = renderOperationalEmail(
      input.templateKey,
      input.templateRevision,
      input.locale,
      input.safeParameters,
      this.#adminOrigin,
    );
    if (
      content === null ||
      canonicalEmail(input.email) !== input.email ||
      !input.email ||
      ![input.companyId, input.attemptId, input.executionId].every((id) => ID.test(id))
    )
      throw new Error('EMAIL_REQUEST_INVALID');
    return JSON.stringify({
      from: this.#from,
      to: [input.email],
      reply_to: this.#replyTo,
      ...content,
      tags: [
        { name: 'company_id', value: input.companyId },
        { name: 'attempt_id', value: input.attemptId },
        { name: 'execution_id', value: input.executionId },
      ],
    });
  }

  private submit(body: string, deadline: Date | null): Promise<ChannelResult> {
    const remaining =
      deadline === null ? this.#timeoutMs : deadline.getTime() - this.#now().getTime();
    if (remaining <= 0) return Promise.resolve({ kind: 'expired' });
    return new Promise((resolve) => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), Math.min(remaining, this.#timeoutMs));
      const finish = (result: ChannelResult) => {
        clearTimeout(timer);
        resolve(result);
      };
      try {
        // فحص الموعد مجاور لبدء الطلب؛ لا await ولا تحويل مسار ولا إعادة تقديم.
        if (deadline !== null && this.#now().getTime() >= deadline.getTime()) {
          finish({ kind: 'expired' });
          return;
        }
        const req = this.#request(
          'https://api.resend.com/emails',
          {
            method: 'POST',
            signal: abort.signal,
            headers: {
              authorization: `Bearer ${this.#key}`,
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(body),
            },
          },
          (response) => readResponse(response, finish),
        );
        req.on('error', () => finish(unknown('NETWORK_UNKNOWN')));
        req.end(body);
      } catch {
        finish(unknown('NETWORK_UNKNOWN'));
      }
    });
  }
}

function readResponse(response: HttpResponse, finish: (result: ChannelResult) => void): void {
  const status = response.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    finish(
      status >= 400 && status < 500
        ? { kind: 'rejected', code: 'PROVIDER_4XX', outcomeKnown: true }
        : unknown(status >= 500 ? 'PROVIDER_5XX' : 'RESPONSE_INVALID'),
    );
    response.destroy();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  response.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > 16_384) {
      finish(unknown('RESPONSE_INVALID'));
      response.destroy();
    } else chunks.push(chunk);
  });
  response.on('error', () => finish(unknown('NETWORK_UNKNOWN')));
  response.on('aborted', () => finish(unknown('NETWORK_UNKNOWN')));
  response.on('end', () => {
    try {
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id?: unknown };
      finish(
        typeof data.id === 'string' && ID.test(data.id)
          ? { kind: 'accepted', providerMessageId: data.id }
          : unknown('RESPONSE_INVALID'),
      );
    } catch {
      finish(unknown('RESPONSE_INVALID'));
    }
  });
}
