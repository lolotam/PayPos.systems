import { WHATSAPP_PROVIDER_ID } from '../identifier-patterns.ts';
import type { Channel, ChannelRequest, ChannelResult } from '../channel.ts';
import { GRAPH_API_VERSION } from '../configuration.ts';

export interface WhatsAppOptions {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly now: () => Date;
  readonly request?: typeof fetch;
}

const MESSAGE_ID = /^[a-zA-Z0-9._=-]{1,512}$/;
const unknown = (code: 'NETWORK_UNKNOWN' | 'RESPONSE_INVALID' | 'PROVIDER_5XX'): ChannelResult => ({
  kind: 'unknown',
  code,
  outcomeKnown: false,
});

export class WhatsAppChannel implements Channel {
  readonly #request: typeof fetch;
  readonly #endpoint: string;
  constructor(readonly options: WhatsAppOptions) {
    if (!WHATSAPP_PROVIDER_ID.test(options.phoneNumberId) || options.accessToken.length === 0) {
      throw new Error('NOTIFICATION_PROVIDER_CONFIG_INVALID');
    }
    this.#request = options.request ?? fetch;
    this.#endpoint = `https://graph.facebook.com/${GRAPH_API_VERSION}/${options.phoneNumberId}/messages`;
  }

  async send(input: ChannelRequest): Promise<ChannelResult> {
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.phone,
      type: 'template',
      template: {
        name: input.providerTemplateName,
        language: { code: input.locale },
        components: input.components,
      },
    });
    const headers = {
      authorization: `Bearer ${this.options.accessToken}`,
      'content-type': 'application/json',
    };
    const abort = new AbortController();
    const remaining =
      input.deadline === null ? 10_000 : input.deadline.getTime() - this.options.now().getTime();
    if (remaining <= 0) return { kind: 'expired' };
    const timer = setTimeout(() => abort.abort(), Math.min(10_000, remaining));
    try {
      // Last clock check and submission are synchronous neighbours; no redirect or automatic retry.
      if (input.deadline !== null && this.options.now().getTime() >= input.deadline.getTime())
        return { kind: 'expired' };
      const response = await this.#request(this.#endpoint, {
        method: 'POST',
        headers,
        body,
        redirect: 'error',
        signal: abort.signal,
      });
      if (response.status >= 400 && response.status < 500) {
        await response.body?.cancel();
        return { kind: 'rejected', code: 'PROVIDER_4XX', outcomeKnown: true };
      }
      if (!response.ok) {
        await response.body?.cancel();
        return unknown('PROVIDER_5XX');
      }
      return await acceptedResponse(response);
    } catch {
      return unknown('NETWORK_UNKNOWN');
    } finally {
      clearTimeout(timer);
    }
  }
}

async function acceptedResponse(response: Response): Promise<ChannelResult> {
  const reader = response.body?.getReader();
  if (reader === undefined) return unknown('RESPONSE_INVALID');
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 16_384) {
        await reader.cancel();
        return unknown('RESPONSE_INVALID');
      }
      chunks.push(chunk.value);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      messages?: { id?: unknown }[];
    };
    const id = payload.messages?.length === 1 ? payload.messages[0]?.id : undefined;
    return typeof id === 'string' && MESSAGE_ID.test(id)
      ? { kind: 'accepted', providerMessageId: id }
      : unknown('RESPONSE_INVALID');
  } catch {
    return unknown('RESPONSE_INVALID');
  } finally {
    reader.releaseLock();
  }
}
