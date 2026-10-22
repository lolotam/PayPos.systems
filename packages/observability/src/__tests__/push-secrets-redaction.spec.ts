import { Writable } from 'node:stream';

import type { Logger } from 'pino';
import { describe, expect, it } from 'vitest';

import { createLogger } from '../logger.ts';

// نفس التقاط الـ logger في leak-paths.spec.ts: السطر المكتوب فعلاً هو اللي بيتفحص.
const capture = (log: (logger: Logger) => void): string => {
  let written = '';
  const sink = new Writable({
    write(chunk, _encoding, done) {
      written += String(chunk);
      done();
    },
  });
  log(
    createLogger('info', {
      destination: sink,
      events: ['probe', 'event'],
    }),
  );
  return written;
};

describe('the push subscription fields', () => {
  it('the endpoint, the keys, the token and the references never reach the line', () => {
    const raw = capture((log) =>
      log.info(
        {
          endpoint: 'https://fcm.googleapis.com/fcm/send/ep_leak',
          p256dh: 'p256dh_leak',
          auth: 'push_auth_leak',
          delivery_token: 'delivery_leak',
          deliveryToken: 'delivery_camel_leak',
          installation_id: 'installation_leak',
          installationId: 'installation_camel_leak',
          subscriber_ref: 'subscriber_leak',
          subscriberRef: 'subscriber_camel_leak',
        },
        'event',
      ),
    );
    for (const leak of [
      'ep_leak',
      'p256dh_leak',
      'push_auth_leak',
      'delivery_leak',
      'delivery_camel_leak',
      'installation_leak',
      'installation_camel_leak',
      'subscriber_leak',
      'subscriber_camel_leak',
    ])
      expect(raw, leak).not.toContain(leak);
  });

  it('an ordinary key that only looks like one of them is kept (author)', () => {
    const line = JSON.parse(capture((log) => log.info({ author: 'Mona' }, 'event')));
    expect(line).toMatchObject({ author: 'Mona' });
  });
});
