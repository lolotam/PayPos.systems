import type { Channel, ChannelRequest, ChannelResult } from '../channel.ts';

export type FakeOutcome = 'accepted' | '4xx' | '429' | '5xx' | 'timeout' | 'crash';
export interface FakeChannelHooks {
  readonly beforeSubmission?: () => void | Promise<void>;
  readonly afterSubmission?: () => void | Promise<void>;
}

export class FakeChannel implements Channel {
  calls = 0;
  outcome: FakeOutcome = 'accepted';
  constructor(
    readonly now: () => Date,
    readonly hooks: FakeChannelHooks = {},
  ) {}

  async send(request: ChannelRequest): Promise<ChannelResult> {
    await this.hooks.beforeSubmission?.();
    if (request.deadline !== null && this.now().getTime() >= request.deadline.getTime())
      return { kind: 'expired' };
    this.calls += 1;
    if (this.outcome === 'crash') throw new Error('FAKE_EXECUTION_CRASH');
    await this.hooks.afterSubmission?.();
    if (this.outcome === 'accepted')
      return { kind: 'accepted', providerMessageId: 'fake-message-id' };
    if (this.outcome === '4xx' || this.outcome === '429')
      return { kind: 'rejected', code: 'PROVIDER_4XX', outcomeKnown: true };
    return {
      kind: 'unknown',
      code: this.outcome === '5xx' ? 'PROVIDER_5XX' : 'NETWORK_UNKNOWN',
      outcomeKnown: false,
    };
  }
}
