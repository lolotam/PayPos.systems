import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.loadEnvFile(new URL('../../.env', import.meta.url));
for (const name of ['DATABASE_URL', 'AUTH_DATABASE_URL', 'MIGRATION_DATABASE_URL'])
  assert.equal(new URL(process.env[name]).pathname, '/pospay_wt_l5', 'WORKTREE_DATABASE_MISMATCH');
const env = { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'info' };
delete env.FORCE_COLOR;
for (const name of [
  'PLATFORM_NOTIFICATIONS_DATABASE_URL',
  'NOTIFICATIONS_MODE',
  'NOTIFICATION_PHONE_HASH_KEY',
  'NOTIFICATION_PHONE_HASH_KEY_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  'WHATSAPP_WABA_ID',
  'WHATSAPP_GRAPH_API_VERSION',
  'RESEND_API_KEY',
  'EMAIL_FROM_ADDRESS',
  'EMAIL_FROM_NAME',
  'EMAIL_REPLY_TO',
  'EMAIL_ADMIN_ORIGIN',
  'NOTIFICATION_EMAIL_HASH_KEY',
  'NOTIFICATION_EMAIL_HASH_KEY_ID',
  'COOKIE_DOMAIN',
  'AUTH_TRUSTED_ORIGINS',
  'TRUSTED_PROXY_CIDRS',
])
  env[name] = '';
const dispatcher = new URL(env.DATABASE_URL);
dispatcher.username = 'pospay_dispatcher';
dispatcher.password = env.POSTGRES_DISPATCHER_PASSWORD;
env.DISPATCHER_DATABASE_URL = dispatcher.href;

async function unusedPort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function smoke(app) {
  const port = await unusedPort();
  const options =
    app === 'api'
      ? {
          API_HOST: '127.0.0.1',
          API_PORT: String(port),
          BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
        }
      : { WORKER_HOST: '127.0.0.1', WORKER_PORT: String(port) };
  const child = spawn(process.execPath, [`apps/${app}/dist/main.js`], {
    cwd: root,
    env: { ...env, ...options },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  const capture = (chunk) => {
    output = `${output}${chunk}`.slice(-100_000);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const exited = once(child, 'exit');
  const deadline = Date.now() + 20_000;
  const kill = setTimeout(() => child.kill(), 25_000);
  try {
    let ready = false;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        const health = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(500),
        });
        const response = await fetch(`http://127.0.0.1:${port}/ready`, {
          signal: AbortSignal.timeout(500),
        });
        if (health.status === 200 && response.status === 200) {
          ready = true;
          break;
        }
      } catch {
        /* البداية لها مهلة محدودة؛ لا نطبع diagnostics قد تحمل بيانات بيئة. */
      }
      await delay(150);
    }
    if (!ready) {
      for (const line of output.split('\n')) {
        try {
          const record = JSON.parse(line);
          if (record.err)
            console.log(
              `${app}: startup diagnostic`,
              JSON.stringify({ msg: record.msg, err: record.err }),
            );
        } catch {
          /* الحقول المنظمة المنقّحة فقط؛ stderr الخام لا يطبع. */
        }
      }
    }
    assert.ok(ready, `${app}: production health/readiness failed`);
    assert.match(
      output,
      /"channel":"email","enabled":false,"reason":"EMAIL_FEEDBACK_NOT_IMPLEMENTED"/,
    );
    if (app === 'api') {
      const webhook = await fetch(`http://127.0.0.1:${port}/v1/webhooks/whatsapp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(webhook.status, 503);
    }
    console.log(
      `${app}: NODE_ENV=production; empty optional settings; health=200 ready=200 email=disabled`,
    );
  } finally {
    child.kill();
    await exited;
    clearTimeout(kill);
  }
}

await smoke('api');
await smoke('worker');
console.log('production smoke passed; child processes stopped');
