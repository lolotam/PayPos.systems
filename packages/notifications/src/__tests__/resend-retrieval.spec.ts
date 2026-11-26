import { readFileSync } from 'node:fs';
import { createServer, request, type RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { expect, it } from 'vitest';

import { createResendEmailRetriever } from '../adapters/resend-retrieval.ts';
import { createEmailIdentity } from '../email-identity.ts';

const PROVIDER_ID = '01920000-0000-7000-8000-000000000004';
const COMPANY = '01920000-0000-7000-8000-000000000001';
const ATTEMPT = '01920000-0000-7000-8000-000000000002';
const EXECUTION = '01920000-0000-7000-8000-000000000003';
const RECIPIENT = 'synthetic.owner@example.invalid';
const HASH_KEY = 'synthetic-retrieval-hash-key'.repeat(3);
const HASH_KEY_ID = 'email-test-v1';

const identity = createEmailIdentity(HASH_KEY, HASH_KEY_ID);

interface Loopback {
  readonly state: {
    status: number;
    body: string;
    delayMs: number;
    paths: string[];
    headers: IncomingMessage['headers'];
  };
  readonly request: typeof request;
  close(): Promise<void>;
}

async function loopback(): Promise<Loopback> {
  // The synthetic certificate and key are published for loopback tests only; they are not run data.
  const cert = readFileSync(new URL('./fixtures/loopback-cert.pem', import.meta.url));
  const key = readFileSync(new URL('./fixtures/loopback-key.pem', import.meta.url));
  const state = {
    status: 200,
    body: JSON.stringify({
      id: PROVIDER_ID,
      to: [RECIPIENT],
      tags: [
        { name: 'company_id', value: COMPANY },
        { name: 'attempt_id', value: ATTEMPT },
        { name: 'execution_id', value: EXECUTION },
      ],
    }),
    delayMs: 0,
    paths: [] as string[],
    headers: {} as IncomingMessage['headers'],
  };
  const server = createServer({ cert, key }, (req, res) => {
    state.paths.push(req.url ?? '');
    state.headers = req.headers;
    setTimeout(() => {
      res.writeHead(state.status, { 'content-type': 'application/json' });
      res.end(state.body);
    }, state.delayMs);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS');
  const transport = ((
    url: string | URL,
    options: RequestOptions,
    callback: (r: IncomingMessage) => void,
  ) => {
    const path = new URL(String(url)).pathname;
    return request(`https://127.0.0.1:${address.port}${path}`, { ...options, ca: cert }, callback);
  }) as typeof request;
  return {
    state,
    request: transport,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function retriever(server: Loopback, timeoutMs = 1000) {
  return createResendEmailRetriever({
    apiKey: 'synthetic-test-only',
    identify: (canonical) => {
      const hashed = identity.identify(canonical);
      return { hash: hashed.hash, keyId: hashed.hashKeyId };
    },
    timeoutMs,
    request: server.request,
  });
}

it('reads the correlation tags and hashes the recipient without letting the address out', async () => {
  const server = await loopback();
  try {
    const result = await retriever(server).retrieve(PROVIDER_ID);
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.id).toBe(PROVIDER_ID);
    expect(result.tags).toEqual({
      companyId: COMPANY,
      attemptId: ATTEMPT,
      executionId: EXECUTION,
    });
    expect(result.recipientHash).toEqual(identity.identify(RECIPIENT).hash);
    expect(result.hashKeyId).toBe(HASH_KEY_ID);
    expect(JSON.stringify(result)).not.toContain(RECIPIENT);
    expect(server.state.paths).toEqual([`/emails/${PROVIDER_ID}`]);
    expect(server.state.headers['authorization']).toBe('Bearer synthetic-test-only');
  } finally {
    await server.close();
  }
});

it('accepts the tags as a plain record and hashes the canonical address', async () => {
  const server = await loopback();
  try {
    server.state.body = JSON.stringify({
      id: PROVIDER_ID,
      to: ['synthetic.owner@EXAMPLE.invalid'],
      tags: { company_id: COMPANY, attempt_id: ATTEMPT, execution_id: EXECUTION },
    });
    const result = await retriever(server).retrieve(PROVIDER_ID);
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.recipientHash).toEqual(identity.identify(RECIPIENT).hash);
  } finally {
    await server.close();
  }
});

it('refuses a body whose id, recipient or tags do not validate', async () => {
  const server = await loopback();
  try {
    server.state.body = JSON.stringify({ id: 'other-id', to: [RECIPIENT], tags: [] });
    expect(await retriever(server).retrieve(PROVIDER_ID)).toEqual({
      kind: 'invalid_tags',
      reason: 'TAGS_INVALID',
    });

    server.state.body = JSON.stringify({
      id: PROVIDER_ID,
      to: ['not-an-address'],
      tags: [
        { name: 'company_id', value: COMPANY },
        { name: 'attempt_id', value: ATTEMPT },
        { name: 'execution_id', value: EXECUTION },
      ],
    });
    expect(await retriever(server).retrieve(PROVIDER_ID)).toEqual({
      kind: 'invalid_tags',
      reason: 'RECIPIENT_INVALID',
    });

    server.state.body = JSON.stringify({
      id: PROVIDER_ID,
      to: [RECIPIENT, 'second@example.invalid'],
      tags: [
        { name: 'company_id', value: COMPANY },
        { name: 'attempt_id', value: ATTEMPT },
        { name: 'execution_id', value: EXECUTION },
      ],
    });
    expect(await retriever(server).retrieve(PROVIDER_ID)).toEqual({
      kind: 'invalid_tags',
      reason: 'RECIPIENT_INVALID',
    });

    server.state.body = JSON.stringify({
      id: PROVIDER_ID,
      to: [RECIPIENT],
      tags: [
        { name: 'company_id', value: COMPANY },
        { name: 'attempt_id', value: 'not-a-uuid' },
        { name: 'execution_id', value: EXECUTION },
      ],
    });
    expect(await retriever(server).retrieve(PROVIDER_ID)).toEqual({
      kind: 'invalid_tags',
      reason: 'TAGS_INVALID',
    });
  } finally {
    await server.close();
  }
});

it('treats every provider refusal, timeout and broken body as transient', async () => {
  const server = await loopback();
  try {
    for (const status of [404, 408, 429, 500, 503]) {
      server.state.status = status;
      server.state.body = JSON.stringify({ message: 'refused' });
      const result = await retriever(server).retrieve(PROVIDER_ID);
      expect(result.kind).toBe('transient');
    }

    server.state.status = 200;
    server.state.body = '{not json';
    expect((await retriever(server).retrieve(PROVIDER_ID)).kind).toBe('transient');

    server.state.body = JSON.stringify({ id: PROVIDER_ID, to: [RECIPIENT], tags: [] });
    server.state.delayMs = 400;
    const timedOut = await retriever(server, 50).retrieve(PROVIDER_ID);
    expect(timedOut.kind).toBe('transient');
  } finally {
    await server.close();
  }
});

it('refuses a response body larger than the bounded limit', async () => {
  const server = await loopback();
  try {
    server.state.body = JSON.stringify({
      id: PROVIDER_ID,
      to: [RECIPIENT],
      tags: [],
      padding: 'x'.repeat(70_000),
    });
    expect((await retriever(server).retrieve(PROVIDER_ID)).kind).toBe('transient');
  } finally {
    await server.close();
  }
});

it('escapes the provider id in the request path', async () => {
  const server = await loopback();
  try {
    await retriever(server).retrieve('id/../other');
    expect(server.state.paths).toEqual(['/emails/id%2F..%2Fother']);
  } finally {
    await server.close();
  }
});
