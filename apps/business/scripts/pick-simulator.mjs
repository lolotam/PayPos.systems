#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const IOS_RUNTIME = '.SimRuntime.iOS-';

function compareRuntimes([firstRuntime], [secondRuntime]) {
  const first = firstRuntime.split(IOS_RUNTIME)[1].split('-').map(Number);
  const second = secondRuntime.split(IOS_RUNTIME)[1].split('-').map(Number);
  const length = Math.max(first.length, second.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (second[index] ?? 0) - (first[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * بيرجع `udid` لأول iPhone متاح على أحدث iOS runtime فيه iPhone.
 * بنختار الأحدث بدل اسم جهاز ثابت لأن صورة الـ runner بتتغيّر مع الوقت والاسم الثابت هيكسر الشغلانة.
 *
 * @param {{ devices: Record<string, Array<{ udid: string, name: string, isAvailable: boolean, state: string }>> }} list
 * @returns {string}
 */
export function pickSimulator(list) {
  const runtimes = Object.entries(list.devices)
    .filter(([runtime]) => runtime.includes(IOS_RUNTIME))
    .sort(compareRuntimes);

  for (const [, devices] of runtimes) {
    const iphones = devices
      .filter((device) => device.name.startsWith('iPhone') && device.isAvailable === true)
      .sort((first, second) => first.name.localeCompare(second.name));
    if (iphones.length > 0) return iphones[0].udid;
  }

  throw new Error('NO_IPHONE_SIMULATOR');
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const list = JSON.parse(readFileSync(0, 'utf8'));
  process.stdout.write(`${pickSimulator(list)}\n`);
}
