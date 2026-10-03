import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import { once } from 'node:events';

export const fakeCredentials = {
  accessKeyId: 'synthetic-access',
  secretAccessKey: 'synthetic-secret-only',
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const mac = (key: string | Buffer, value: string) =>
  createHmac('sha256', key).update(value).digest();
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

function validSignature(req: IncomingMessage, url: URL): boolean {
  const signature = url.searchParams.get('X-Amz-Signature');
  if (signature === null)
    return req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ') === true;
  const credential = (url.searchParams.get('X-Amz-Credential') ?? '').split('/');
  const [, date = '', region = '', service = ''] = credential;
  const amzDate = url.searchParams.get('X-Amz-Date') ?? '';
  const signed = url.searchParams.get('X-Amz-SignedHeaders') ?? '';
  const headers = signed
    .split(';')
    .map(
      (name) =>
        `${name}:${String(req.headers[name] ?? '')
          .trim()
          .replace(/\s+/g, ' ')}\n`,
    )
    .join('');
  const query = [...url.searchParams]
    .filter(([name]) => name !== 'X-Amz-Signature')
    .map(([name, value]) => [encode(name), encode(value)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  const canonical = [req.method, url.pathname, query, headers, signed, 'UNSIGNED-PAYLOAD'].join(
    '\n',
  );
  const scope = `${date}/${region}/${service}/aws4_request`;
  const signingKey = mac(
    mac(mac(mac(`AWS4${fakeCredentials.secretAccessKey}`, date), region), service),
    'aws4_request',
  );
  return (
    mac(signingKey, ['AWS4-HMAC-SHA256', amzDate, scope, hash(canonical)].join('\n')).toString(
      'hex',
    ) === signature
  );
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function fakeS3() {
  const objects = new Map<string, { bytes: Buffer; type: string }>();
  const requests: { method: string; key: string; headers: IncomingMessage['headers'] }[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const key = decodeURIComponent(url.pathname.replace(/^\/private\//, ''));
    requests.push({ method: req.method ?? '', key, headers: req.headers });
    if (!validSignature(req, url)) {
      res.writeHead(403);
      res.end('<Error><Code>SignatureDoesNotMatch</Code></Error>');
      return;
    }
    if (req.method === 'PUT') {
      if (req.headers['if-none-match'] === '*' && objects.has(key)) {
        res.writeHead(412);
        res.end();
        return;
      }
      objects.set(key, {
        bytes: await readBody(req),
        type: String(req.headers['content-type'] ?? ''),
      });
      res.writeHead(200, { etag: '"synthetic"' });
      res.end();
      return;
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204).end();
      return;
    }
    const object = objects.get(key);
    if (object === undefined) {
      res.writeHead(404);
      res.end('<Error><Code>NoSuchKey</Code></Error>');
      return;
    }
    res.writeHead(200, {
      'content-length': object.bytes.length,
      'content-type': url.searchParams.get('response-content-type') ?? object.type,
      ...(url.searchParams.has('response-content-disposition')
        ? { 'content-disposition': url.searchParams.get('response-content-disposition') ?? '' }
        : {}),
    });
    res.end(object.bytes);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('FAKE_S3_ADDRESS');
  return {
    objects,
    requests,
    endpoint: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
