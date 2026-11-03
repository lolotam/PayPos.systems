import { connect, type AddressInfo } from 'node:net';
import { Writable } from 'node:stream';

import { COMMISSION_PLAN_EMPLOYEE_CURSOR_MAX } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { API_MAX_HEADER_BYTES, buildAdapter } from '../../app.ts';

// A real socket on the real adapter: app.inject() never goes through Node's HTTP parser, which is
// where the header limit lives. The target carries a cursor at the contract's cap, as a page request would.
const sink = new Writable({ write: (_chunk, _encoding, done) => done() });
const adapter = buildAdapter(createLogger('info', { destination: sink }), systemUuidV7(), []);
const server = adapter.getInstance();
const target = `/probe?limit=50&cursor=${'A'.repeat(COMMISSION_PLAN_EMPLOYEE_CURSOR_MAX)}`;
let port = 0;

beforeAll(async () => {
  server.get('/probe', async () => ({ ok: true }));
  await server.listen({ host: '127.0.0.1', port: 0 });
  port = (server.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await server.close();
});

type RawResponse = { readonly head: number; readonly status: string; readonly text: string };

function send(pad: number): Promise<RawResponse> {
  const request = `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Pad: ${'x'.repeat(pad)}\r\n\r\n`;
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(request));
    let text = '';
    socket.on('data', (chunk) => {
      text += chunk.toString('utf8');
      if (/\r\n\r\n[\s\S]*\}/.test(text)) socket.end();
    });
    socket.on('close', () =>
      resolve({ head: Buffer.byteLength(request), status: text.slice(9, 12), text }),
    );
  });
}

it('the HTTP server enforces the explicit header limit', () => {
  expect(API_MAX_HEADER_BYTES).toBe(32_768);
  // Node sets this on the server at runtime; @types/node does not declare it.
  const http = server.server as { readonly maxHeaderSize?: number };
  expect(http.maxHeaderSize).toBe(API_MAX_HEADER_BYTES);
});

it('a page request at the cursor cap is served up to the limit and refused one byte past it', async () => {
  let low = 0;
  let high = API_MAX_HEADER_BYTES;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((await send(middle)).status === '200') low = middle;
    else high = middle - 1;
  }
  const lastServed = await send(low);
  const firstRefused = await send(low + 1);
  expect(lastServed.status).toBe('200');
  // Node counts the request line and the headers together; the boundary sits at the limit plus the
  // few framing bytes its parser leaves out (24 in this request shape), never at the old 16 KiB default.
  expect(lastServed.head).toBeGreaterThanOrEqual(API_MAX_HEADER_BYTES);
  expect(lastServed.head).toBeLessThan(API_MAX_HEADER_BYTES + 64);
  expect(firstRefused.head).toBe(lastServed.head + 1);
  expect(firstRefused.status).toBe('431');
  // Fastify answers on the socket before Nest runs, so this is its raw body and not our envelope.
  expect(firstRefused.text).toContain('Request Header Fields Too Large');
  expect(firstRefused.text).not.toContain('message_ar');
});
