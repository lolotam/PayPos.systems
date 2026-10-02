export interface NotificationRedisOptions {
  readonly host: string;
  readonly port: number;
  readonly db: number;
  readonly username?: string;
  readonly password?: string;
  readonly tls?: Record<string, never>;
}
export function notificationRedisOptions(url: string): NotificationRedisOptions {
  const parsed = new URL(url);
  if (!['redis:', 'rediss:'].includes(parsed.protocol))
    throw new Error('NOTIFICATION_REDIS_CONFIG_INVALID');
  return {
    host: parsed.hostname,
    port: Number(parsed.port || '6379'),
    ...(parsed.username === '' ? {} : { username: decodeURIComponent(parsed.username) }),
    ...(parsed.password === '' ? {} : { password: decodeURIComponent(parsed.password) }),
    db: parsed.pathname === '/' || parsed.pathname === '' ? 0 : Number(parsed.pathname.slice(1)),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
