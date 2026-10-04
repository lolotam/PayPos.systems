import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

// جهاز اختبار مصطنع: نفس بايتات WebAuthn القياسية، بلا browser أو مكتبة تحقق بديلة.
function header(major: number, length: number): Buffer {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length < 256) return Buffer.from([(major << 5) | 24, length]);
  const result = Buffer.alloc(3);
  result[0] = (major << 5) | 25;
  result.writeUInt16BE(length, 1);
  return result;
}
function cbor(value: string | number | Buffer | Map<number | string, unknown>): Buffer {
  if (typeof value === 'number') return header(value < 0 ? 1 : 0, value < 0 ? -1 - value : value);
  if (value instanceof Map)
    return Buffer.concat([
      header(5, value.size),
      ...Array.from(value, ([k, v]) =>
        Buffer.concat([cbor(k), cbor(v as Parameters<typeof cbor>[0])]),
      ),
    ]);
  const bytes = typeof value === 'string' ? Buffer.from(value) : value;
  return Buffer.concat([header(typeof value === 'string' ? 3 : 2, bytes.length), bytes]);
}

export function testAuthenticator(synced = false) {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = keys.publicKey.export({ format: 'jwk' });
  if (jwk.x === undefined || jwk.y === undefined) throw new Error('SYNTHETIC_KEY_INVALID');
  const credential = randomBytes(32);
  const publicKey = cbor(
    new Map<number, unknown>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x, 'base64url')],
      [-3, Buffer.from(jwk.y, 'base64url')],
    ]),
  );
  return {
    registration(
      challenge: string,
      origin: string,
      rp: string,
      uv = true,
    ): RegistrationResponseJSON {
      return registration(credential, publicKey, challenge, origin, rp, uv, synced);
    },
    assertion(
      challenge: string,
      origin: string,
      rp: string,
      uv = true,
      counter = 0,
    ): AuthenticationResponseJSON {
      return assertionResponse(
        credential,
        keys.privateKey,
        challenge,
        origin,
        rp,
        uv,
        counter,
        synced,
      );
    },
  };
}

const clientData = (type: string, challenge: string, origin: string) =>
  Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
const authenticatorData = (rp: string, flags: number, counter: number) => {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(counter);
  return Buffer.concat([createHash('sha256').update(rp).digest(), Buffer.from([flags]), count]);
};

function registration(
  credential: Buffer,
  publicKey: Buffer,
  challenge: string,
  origin: string,
  rp: string,
  uv: boolean,
  synced: boolean,
): RegistrationResponseJSON {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(credential.length);
  const data = Buffer.concat([
    authenticatorData(rp, 0x41 | (uv ? 4 : 0) | (synced ? 0x18 : 0), 0),
    Buffer.alloc(16),
    length,
    credential,
    publicKey,
  ]);
  return {
    id: credential.toString('base64url'),
    rawId: credential.toString('base64url'),
    type: 'public-key',
    authenticatorAttachment: 'platform',
    clientExtensionResults: { credProps: { rk: true } },
    response: {
      clientDataJSON: clientData('webauthn.create', challenge, origin).toString('base64url'),
      attestationObject: cbor(
        new Map<string, unknown>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', data],
        ]),
      ).toString('base64url'),
      transports: ['internal'],
    },
  };
}
function assertionResponse(
  credential: Buffer,
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  challenge: string,
  origin: string,
  rp: string,
  uv: boolean,
  counter: number,
  synced: boolean,
): AuthenticationResponseJSON {
  const data = authenticatorData(rp, 1 | (uv ? 4 : 0) | (synced ? 0x18 : 0), counter);
  const client = clientData('webauthn.get', challenge, origin);
  const signature = sign(
    'sha256',
    Buffer.concat([data, createHash('sha256').update(client).digest()]),
    privateKey,
  );
  return {
    id: credential.toString('base64url'),
    rawId: credential.toString('base64url'),
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: client.toString('base64url'),
      authenticatorData: data.toString('base64url'),
      signature: signature.toString('base64url'),
    },
  };
}
