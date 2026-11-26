import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { appVersionManifestSchema } from '@pospay/contracts';
import { describe, expect, it } from 'vitest';

/** ملفات النسخة اللي بتتبعت للنسخة الأصلية (VER-T04). */
const FILES = {
  staging: resolve(process.cwd(), 'public/app-version/staging.json'),
  production: resolve(process.cwd(), 'public/app-version/production.json'),
};

describe('the committed version files (VER-T04)', () => {
  it.each(['staging', 'production'] as const)(
    'the %s file matches the contracts schema',
    (flavour) => {
      const raw = JSON.parse(readFileSync(FILES[flavour], 'utf8')) as unknown;

      expect(appVersionManifestSchema.safeParse(raw).success).toBe(true);
    },
  );

  it.each(['staging', 'production'] as const)(
    'the %s file starts at the first signed version',
    (flavour) => {
      const manifest = appVersionManifestSchema.parse(
        JSON.parse(readFileSync(FILES[flavour], 'utf8')) as unknown,
      );

      expect(manifest.ios.minimum).toBe('1.0.0');
      expect(manifest.android.minimum).toBe('1.0.0');
      expect(manifest.ios.latest).toBe('1.0.0');
      expect(manifest.android.latest).toBe('1.0.0');
    },
  );
});
