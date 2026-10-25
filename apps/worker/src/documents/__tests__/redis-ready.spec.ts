import net from 'node:net';
import { expect, it } from 'vitest';

import {
  closeRender,
  openRender,
  redisUrl,
  renderId,
  seedQueued,
  statusOf,
  type Opened,
} from './render-harness.ts';

interface SlowRedis {
  readonly url: string;
  stop(): Promise<void>;
}

/** نفس الأصلي بس المضيف والمنفذ بتوع البروكسي؛ الكلمة السرية بتفضل زي ما هي. */
function proxyUrl(target: URL, port: number): string {
  const credentials =
    target.username === '' && target.password === ''
      ? ''
      : `${target.username}${target.password === '' ? '' : `:${target.password}`}@`;
  return `${target.protocol}//${credentials}127.0.0.1:${port}${target.pathname}${target.search}`;
}

/**
 * Redis بطيء قدام اتصال الهارنيس: كل مقبس متسقبل بيتأخر `delayMs` قبل ما يوصل Redis الحقيقي.
 * المقبس المتسقبل بيفضل متوقف (من غير مستمع `data`) عشان بايتات الـ AUTH اللي ioredis بتبعتها
 * وقت التأخير تفضل في البفر وتتflush مع الـ pipe بدل ما تضيع.
 */
async function slowRedis(delayMs: number): Promise<SlowRedis> {
  const target = new URL(redisUrl);
  const clients = new Set<net.Socket>();
  const upstreams = new Set<net.Socket>();
  const server = net.createServer((client) => {
    clients.add(client);
    client.on('error', () => undefined);
    client.on('close', () => {
      clients.delete(client);
    });
    setTimeout(() => {
      if (client.destroyed) return;
      const upstream = net.connect({ host: target.hostname, port: Number(target.port || '6379') });
      upstreams.add(upstream);
      upstream.on('error', () => undefined);
      upstream.on('close', () => {
        upstreams.delete(upstream);
        client.destroy();
      });
      client.on('close', () => {
        upstream.destroy();
      });
      client.pipe(upstream);
      upstream.pipe(client);
    }, delayMs);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('slow redis has no port'));
        return;
      }
      resolve({
        url: proxyUrl(target, address.port),
        stop: () =>
          new Promise((done) => {
            for (const socket of clients) socket.destroy();
            for (const socket of upstreams) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

/**
 * بيحارس issue #672: في CI أول أمر كان بيرفض بـ «Stream isn't writeable and
 * enableOfflineQueue options is false» لما Redis بيقبل الاتصال ببطء.
 * الهارنيس لازم يسلّم اتصال جاهز، وإلا أول أمر في الاختبار بيفشل.
 */
it('opens a ready harness connection when Redis accepts slowly', async () => {
  const proxy = await slowRedis(400);
  let opened: Opened | undefined;
  try {
    opened = await openRender({ awaitStarted: false, redisUrl: proxy.url });
    const companyId = renderId();
    const id = renderId();
    expect(opened.redis.status).toBe('ready');
    await seedQueued(opened, companyId, id);
    expect((await statusOf(opened, companyId, id))['state']).toBe('QUEUED');
  } finally {
    if (opened !== undefined) await closeRender(opened);
    await proxy.stop();
  }
}, 15_000);
