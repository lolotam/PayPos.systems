#!/usr/bin/env node
// أمر المشغّل: يولّد زوج مفاتيح VAPID ويطبعه في الطرفية بس — ولا ملف بيتكتب ولا سر بيتسجل.
import { generateVapidKeyPair } from '../packages/notifications/src/push/vapid-keys.ts';

const { publicKey, privateKey } = generateVapidKeyPair();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.error(
  'Set VAPID_SUBJECT to a mailto: or https: contact. The private key is for the worker only. Nothing was written to disk.',
);
