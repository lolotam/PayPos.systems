// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('packages browser assets beside the traced standalone server', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'pospay-menu-standalone-'));
  try {
    await mkdir(join(fixture, 'scripts'));
    await mkdir(join(fixture, '.next/static/chunks'), { recursive: true });
    await mkdir(join(fixture, '.next/standalone/apps/menu'), { recursive: true });
    await writeFile(join(fixture, '.next/static/chunks/page.js'), 'browser fixture');
    await writeFile(join(fixture, '.next/standalone/apps/menu/server.js'), 'server fixture');
    await cp(
      new URL('../scripts/prepare-standalone.mjs', import.meta.url),
      join(fixture, 'scripts/prepare-standalone.mjs'),
    );
    execFileSync(process.execPath, [join(fixture, 'scripts/prepare-standalone.mjs')]);
    expect(
      await readFile(
        join(fixture, '.next/standalone/apps/menu/.next/static/chunks/page.js'),
        'utf8',
      ),
    ).toBe('browser fixture');
    expect(await readFile(join(fixture, '.next/standalone/apps/menu/server.js'), 'utf8')).toBe(
      'server fixture',
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
