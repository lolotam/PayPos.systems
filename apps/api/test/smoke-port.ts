import { createServer } from 'node:net';

/** يختار النظام منفذاً متاحاً؛ النطاق العشوائي قد يصطدم بمنافذ محجوزة في Windows. */
export function availableSmokePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (address === null || typeof address === 'string')
          reject(new Error('SMOKE_PORT_INVALID'));
        else resolve(address.port);
      });
    });
  });
}
