import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Next يتتبع ملفات الخادم بشكل منفصل؛ وتشغيله يحتاج أيضًا أصول المتصفح الناتجة من البناء.
const appRoot = new URL('../', import.meta.url);
const destination = new URL('.next/standalone/apps/menu/.next/static/', appRoot);
await mkdir(destination, { recursive: true });
await cp(fileURLToPath(new URL('.next/static/', appRoot)), fileURLToPath(destination), {
  recursive: true,
});
