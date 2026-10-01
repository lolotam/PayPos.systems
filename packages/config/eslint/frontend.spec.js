import assert from 'node:assert/strict';
import { it } from 'node:test';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';

import config from './index.js';

const eslint = new ESLint({
  cwd: resolve(import.meta.dirname, '../../..'),
  overrideConfigFile: true,
  overrideConfig: config,
});

for (const filePath of ['packages/ui/src/probe.tsx', 'packages/ui/src/probe.ts']) {
  it(`enforces logical classes through the shared config in ${filePath}`, async () => {
    const physical = filePath.endsWith('.tsx') ? '<div className="ml-2" />;' : 'cn("ml-2");';
    const logical = physical.replace('ml-2', 'ms-2');
    const [bad] = await eslint.lintText(physical, { filePath });
    const [good] = await eslint.lintText(logical, { filePath });
    assert.ok(bad.messages.some((message) => message.ruleId === 'pospay-rtl/no-physical-tailwind'));
    assert.ok(
      !good.messages.some((message) => message.ruleId === 'pospay-rtl/no-physical-tailwind'),
    );
  });
}

it('enforces logical classes in the admin app through the shared config', async () => {
  const filePath = 'apps/admin/src/probe.tsx';
  const [bad] = await eslint.lintText('<div className="ml-2" />;', { filePath });
  const [good] = await eslint.lintText('<div className="ms-2" />;', { filePath });
  assert.ok(bad.messages.some((message) => message.ruleId === 'pospay-rtl/no-physical-tailwind'));
  assert.ok(!good.messages.some((message) => message.ruleId === 'pospay-rtl/no-physical-tailwind'));
});

it('enables recommended hooks rules for TSX', async () => {
  const config = await eslint.calculateConfigForFile('packages/ui/src/probe.tsx');
  assert.equal(config.rules['react-hooks/rules-of-hooks'][0], 2);
  assert.ok(config.rules['react-hooks/exhaustive-deps'][0] > 0);
});
