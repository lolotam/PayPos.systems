import { drizzle, PostgresJsSession, PostgresJsTransaction } from 'drizzle-orm/postgres-js';
import { PgDialect } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { Socket } from 'node:net';
import type { Tx } from './with-tenant.ts';

interface Slot {
  busy: boolean;
  client: ReturnType<typeof postgres>;
  alive(): boolean;
  abort(): Promise<void>;
}

function ownedConnection(url: string): Pick<Slot, 'client' | 'abort' | 'alive'> {
  let socket: Socket | undefined;
  const settings = {
    max: 1,
    onnotice: () => undefined,
    connect_timeout: 1,
    socket: async (options: { host: string[]; port: number[] }) => {
      const transport = new Socket();
      transport.setNoDelay(true);
      socket = transport;
      await new Promise<void>((resolve, reject) => {
        transport.once('error', reject);
        transport.setTimeout(1000, () => transport.destroy(new Error('BOUNDED_CONNECT_TIMEOUT')));
        transport.connect(options.port[0] ?? 5432, options.host[0] ?? '127.0.0.1', () => {
          transport.setTimeout(0);
          transport.removeListener('error', reject);
          resolve();
        });
      });
      return transport;
    },
  };
  const client = postgres(url, settings);
  // يضبط serializers الخاصة بـ Drizzle قبل حجز الاتصال، خصوصاً jsonb والتواريخ.
  drizzle(client);
  return {
    client,
    alive: () => socket !== undefined && !socket.destroyed,
    abort: async () => {
      const transport = socket;
      if (transport !== undefined && !transport.destroyed) {
        await new Promise<void>((resolve) => {
          transport.once('close', resolve);
          transport.destroy();
        });
      }
      await client.end({ timeout: 0 });
    },
  };
}

/** sockets مملوكة للـ lease؛ الإلغاء يغلق نفسه، ولا يستعمل PID يمكن إعادة استخدامه. */
export function boundedPostgres(url: string) {
  const connect = () => ownedConnection(url);
  const slots: Slot[] = Array.from({ length: 8 }, () => ({ busy: false, ...connect() }));
  let warming: Promise<void> | undefined;
  return {
    warm: () =>
      (warming ??= warmSlots(slots).finally(() => {
        warming = undefined;
      })),
    close: async () => {
      await Promise.all(slots.map((s) => s.abort()));
    },
    run: <T>(work: (tx: Tx) => Promise<T>, deadline: Date) => run(slots, connect, work, deadline),
  };
}

async function warmSlots(slots: readonly Slot[]): Promise<void> {
  // cold handshakes متسلسلة ومشتركة بين المتصلين؛ لا ندخل burst اتصالات قبل نافذة الطلب الثابتة.
  for (const slot of slots) if (!slot.busy) await slot.client`SELECT 1`;
}

async function run<T>(
  slots: Slot[],
  connect: () => Pick<Slot, 'client' | 'abort' | 'alive'>,
  work: (tx: Tx) => Promise<T>,
  deadline: Date,
): Promise<T> {
  const slot = slots.find((s) => !s.busy);
  if (slot === undefined || Date.now() >= deadline.getTime())
    throw new Error('BOUNDED_DATABASE_UNAVAILABLE');
  slot.busy = true;
  const client = slot.client;
  let expired = false;
  let closing: Promise<void> | undefined;
  // nextWrite في postgres.js يعمل في immediate؛ اتركه يصرف البايتات المجدولة قبل إغلاق socket.
  const timer = setTimeout(
    () => {
      expired = true;
      closing = new Promise<void>((resolve) =>
        setImmediate(() => {
          void slot.abort().then(resolve);
        }),
      );
    },
    Math.max(1, deadline.getTime() - Date.now() - 30),
  );
  const refuseLate = () => {
    if (expired || Date.now() >= deadline.getTime())
      throw new Error('BOUNDED_DATABASE_UNAVAILABLE');
  };
  try {
    const result = await transaction(client, work, refuseLate, () => expired, slot.alive);
    if (expired) throw new Error('BOUNDED_COMMIT_UNKNOWN');
    return result;
  } finally {
    clearTimeout(timer);
    if (expired || !slot.alive()) {
      await (closing ?? slot.abort());
      Object.assign(slot, connect());
    }
    slot.busy = false;
  }
}

async function transaction<T>(
  client: ReturnType<typeof postgres>,
  work: (tx: Tx) => Promise<T>,
  refuseLate: () => void,
  expired: () => boolean,
  alive: () => boolean,
): Promise<T> {
  const connection = await client.reserve();
  try {
    refuseLate();
    await connection.unsafe('BEGIN ISOLATION LEVEL READ COMMITTED');
    const guarded = new Proxy(connection, {
      get(source, key, receiver) {
        if (key !== 'unsafe') return Reflect.get(source, key, receiver);
        return (...args: Parameters<typeof source.unsafe>) => {
          refuseLate();
          if (!alive()) throw new Error('BOUNDED_DATABASE_UNAVAILABLE');
          return source.unsafe(...args);
        };
      },
    });
    const dialect = new PgDialect();
    const scoped = Object.assign(guarded, {
      savepoint: () => {
        throw new Error('BOUNDED_SAVEPOINT_REFUSED');
      },
      prepare: () => {
        throw new Error('BOUNDED_PREPARE_REFUSED');
      },
    });
    const session = new PostgresJsSession<
      typeof scoped,
      Record<string, never>,
      Record<string, never>
    >(scoped, dialect, undefined);
    const tx: Tx = new PostgresJsTransaction(dialect, session, undefined);
    const value = await work(tx);
    refuseLate();
    await connection.unsafe('COMMIT');
    return value;
  } catch (error) {
    // بعد close في postgres.js يصبح socket فارغاً؛ ROLLBACK جديد عليه يترك nextWrite بلا socket.
    if (!expired() && alive()) await connection.unsafe('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}
