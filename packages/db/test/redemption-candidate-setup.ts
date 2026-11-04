import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import type { ProvidedContext } from 'vitest';
import type { TestProject } from 'vitest/node';
import setup from './global-setup.ts';
import { pgUrl, readPgTestEnv } from './pg-env.ts';

// تجهيز محلي مؤقت قبل lane grant؛ لا يغيّر bootstrap المشترك أو journal الإنتاج.
export default async function candidateSetup(project: TestProject) {
  const env = readPgTestEnv();
  if (env.host !== '127.0.0.1' || env.port !== '55445') throw new Error('43-1 requires its private loopback lane');
  const root = resolve(fileURLToPath(new URL('../../../', import.meta.url))).toLowerCase();
  const inspected: { Config: { Image: string; Labels: Record<string, string> }; NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[]> }; Mounts: { Type: string; Destination: string }[] }[] =
    JSON.parse(execFileSync('docker', ['inspect', 'pospay-test-sol-43-storage-121'], { encoding: 'utf8' }));
  const container = inspected[0];
  const binding = container?.NetworkSettings.Ports['5432/tcp'];
  if (container?.Config.Image !== 'postgres:16-alpine'
    || container.Config.Labels['pospay.test-lane'] !== 'sol-43-storage-121'
    || container.Config.Labels['pospay.test-worktree']?.replaceAll('/', '\\') !== root.replaceAll('/', '\\')
    || binding?.length !== 1 || binding[0]?.HostIp !== env.host || binding[0].HostPort !== env.port
    || !container.Mounts.some((mount) => mount.Type === 'volume' && mount.Destination === '/var/lib/postgresql/data')) {
    throw new Error('43-1 private PG16 container ownership mismatch');
  }
  let pg: ProvidedContext['pg'] | undefined;
  const local = Object.create(project) as TestProject;
  local.provide = (key, value) => {
    if (key === 'pg') pg = value as ProvidedContext['pg'];
    project.provide(key, value);
  };
  const teardown = await setup(local);
  if (pg === undefined) { await teardown(); throw new Error('43-1 baseline template was not provided'); }
  const config = pg as ProvidedContext['pg'];
  const maintenance = postgres(pgUrl(config, config.ownerUser, config.ownerPassword, 'postgres'), { max: 1 });
  try {
    await maintenance.unsafe(`ALTER DATABASE "${config.template}" ALLOW_CONNECTIONS true`);
    const owner = postgres(pgUrl(config, config.ownerUser, config.ownerPassword, config.template), { max: 1 });
    try {
      const candidate = readFileSync(new URL('../../../docs/specs/058-packages-sell-redeem/43-1-candidate.sql', import.meta.url), 'utf8');
      await owner.begin(async (tx) => { await tx.unsafe(candidate); });
    } finally { await owner.end(); }
    await maintenance.unsafe(`ALTER DATABASE "${config.template}" ALLOW_CONNECTIONS false`);
  } catch (error) { await teardown(); throw error; }
  finally { await maintenance.end(); }
  return teardown;
}
