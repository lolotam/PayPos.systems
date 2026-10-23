import { describe, expect, it } from 'vitest';

import { pushConfigFor } from '../push-config.query.ts';

const CONFIG = {
  publicKey: 'BPublicKey',
  keyId: '0123456789abcdef',
  subject: 'mailto:ops@pospay.systems',
};

const ref = (userId: string) => `ref-${userId}`;

describe('pushConfigFor', () => {
  it('is not ready when push is not configured', () => {
    expect(pushConfigFor(null, 'user-1', ref)).toBeNull();
  });

  it('serves the public key, its id and the caller reference', () => {
    expect(pushConfigFor(CONFIG, 'user-1', ref)).toEqual({
      vapid_public_key: 'BPublicKey',
      vapid_key_id: '0123456789abcdef',
      subscriber_ref: 'ref-user-1',
    });
  });

  it('gives two callers two references and never the other one', () => {
    const first = pushConfigFor(CONFIG, 'user-1', ref);
    const second = pushConfigFor(CONFIG, 'user-2', ref);
    expect(first?.subscriber_ref).not.toBe(second?.subscriber_ref);
  });
});
