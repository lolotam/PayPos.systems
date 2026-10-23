// عملية من عمليات اختبار السباق في lane-lock.test.mjs: بتمسك الـ start lock وبتتأكد إن محدش جوه معاها.
import { openSync, closeSync, rmSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

import { withStartLock } from './lane-lock.mjs';

const [lock, inside] = process.argv.slice(2);
await withStartLock(
  lock,
  async () => {
    // 'wx' بيفشل لو الملف موجود: يعني عملية تانية جوه الـ lock في نفس الوقت.
    closeSync(openSync(inside, 'wx'));
    await delay(100);
    rmSync(inside);
  },
  { waitMs: 120_000 },
);
