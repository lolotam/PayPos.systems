import { WhatsappEnvelopeInvalidError } from '@pospay/contracts';
import { expect, it, vi } from 'vitest';
import { whatsappEnvelope } from '@pospay/contracts';
import { config, envelope } from './whatsapp-harness.ts';
import { createWhatsappEnvelopeAdapter } from '../../persistence/whatsapp-envelope.adapter.ts';
import { ReceiveWhatsappStop } from '../../use-cases/receive-whatsapp-stop/receive-whatsapp-stop.ts';
import { whatsappFailure } from '../whatsapp-failure.ts';

it('processes every valid message above 100 in bounded groups and skips invalid messages', async () => {
  const input = envelope();
  const change = input.entry[0]?.changes[0];
  const first = change?.value.messages[0];
  if (change === undefined || first === undefined) throw new Error('TEST_MESSAGE_MISSING');
  const messages = Array.from({ length: 101 }, (_, i) => ({
    ...first,
    id: `test.batch-limit.${i}`,
  }));
  const skipped = vi.fn();
  const parsed = whatsappEnvelope.parse({
    ...input,
    entry: [
      {
        id: config.wabaId,
        changes: [{ ...change, value: { ...change.value, messages: [null, ...messages] } }],
      },
    ],
  });
  const scrubbed = createWhatsappEnvelopeAdapter(config, skipped)(parsed);
  expect(scrubbed).toHaveLength(101);
  expect(scrubbed.every((message) => message.command === 'STOP')).toBe(true);
  expect(skipped).toHaveBeenCalledWith(1);
  const sizes: number[] = [];
  const receive = new ReceiveWhatsappStop(
    {
      accept: async (batch) => {
        sizes.push(batch.length);
        return [];
      },
      confirmEnqueue: async () => undefined,
    },
    { enqueue: async () => undefined },
    { now: () => new Date('2026-10-01T10:00:00Z') },
  );
  await receive.execute(scrubbed);
  expect(sizes).toEqual([100, 1]);
});

it('classifies nested database timeouts without trusting error messages or copying private fields', () => {
  const cause = Object.assign(new Error('test-secret'), {
    name: 'PostgresError',
    code: '55P03',
    detail: '+96500000001',
  });
  expect(whatsappFailure(new Error('test-secret', { cause }))).toEqual({
    transient: true,
    diagnostic: { type: 'Error', pgCode: '55P03' },
  });
  expect(whatsappFailure(new Error('WHATSAPP_ENVELOPE_INVALID')).transient).toBe(false);
  expect(new WhatsappEnvelopeInvalidError()).toBeInstanceOf(WhatsappEnvelopeInvalidError);
});
