import { Writable } from 'node:stream';

import { createLogger } from '@pospay/observability';
import { describe, expect, it } from 'vitest';

import { PinoNestLogger } from '../nest-logger.ts';

describe('PinoNestLogger', () => {
  it('never prints the text or stack of a Nest error or warning', () => {
    let written = '';
    const sink = new Writable({
      write(chunk, _encoding, done) {
        written += String(chunk);
        done();
      },
    });
    const logger = new PinoNestLogger(createLogger('debug', sink));
    logger.error(
      'connect postgres://app:leaked-password@db failed',
      'at stack-frame',
      'InstanceLoader',
    );
    logger.error(new Error('token=tok_nest_secret'), 'ExceptionHandler');
    logger.warn('using key key_live_nest', 'Bootstrap');
    for (const secret of ['leaked-password', 'tok_nest_secret', 'key_live_nest']) {
      expect(written).not.toContain(secret);
    }
    expect(written).toContain('"nest":"InstanceLoader"');
  });
});
