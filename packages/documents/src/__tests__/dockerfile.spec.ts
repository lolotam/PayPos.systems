import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../..');

it('C4 keeps the worker image off root', () => {
  const dockerfile = readFileSync(resolve(root, 'deploy/Dockerfile.worker'), 'utf8');
  const users = [...dockerfile.matchAll(/^USER\s+(\S+)/gm)].map((match) => match[1]);
  expect(users.at(-1)).toBe('node');
  expect(dockerfile.match(/FROM node:24-bookworm-slim/g)).toHaveLength(2);
  expect(dockerfile).not.toContain('alpine');
  expect(dockerfile).not.toContain('wget');
  const smoke = readFileSync(resolve(root, 'packages/documents/scripts/pdf-smoke.mjs'), 'utf8');
  expect(smoke).toContain('process.getuid');
  expect(smoke).toContain('uid === 0');
  expect(smoke).toContain("console.log(`uid=");
  expect(smoke).toContain('rendererFailureText');
});

it('AC-12 keeps the renderer out of the API package', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'apps/api/package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const names = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ];
  expect(names).not.toContain('@pospay/documents');
  expect(names).not.toContain('playwright-core');
});
