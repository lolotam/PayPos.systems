/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

import { pushRecordStore } from './personal-staff/push/push-record-idb';
import { handleNotificationClick, handlePush } from './personal-staff/push/sw-handlers';

declare let self: ServiceWorkerGlobalScope;

declare global {
  interface ServiceWorkerGlobalScope {
    __WB_MANIFEST: (PrecacheEntry | string)[];
  }
}

// التفعيل الفوري والتقاط النوافذ: نفس سلوك registerType: 'autoUpdate' اللي كان في الـ build القديم.
self.addEventListener('install', () => {
  void self.skipWaiting();
});
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
// بديل التنقل: نفس index.html اللي كان في navigateFallback، عشان فتح أي مسار بيفتح التطبيق.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

self.addEventListener('push', (event) => {
  event.waitUntil(runPush(event.data));
});

self.addEventListener('notificationclick', (event) => {
  event.waitUntil(runNotificationClick(event.notification));
});

async function runPush(message: PushMessageData | null): Promise<void> {
  const data = message === null ? null : await message.text();
  await handlePush({ data, registration: self.registration, store: pushRecordStore });
}

async function runNotificationClick(notification: Notification): Promise<void> {
  await handleNotificationClick({
    notification: {
      close: () => notification.close(),
      data: (notification.data ?? null) as { url?: string } | null,
    },
    clients: {
      matchAll: (options) => self.clients.matchAll(options),
      openWindow: (url) => self.clients.openWindow(url),
    },
    // نطاق التسجيل مطلق دايماً، فبيبقى أصل الصفحة من غير ما نقرا من الـ worker.
    origin: new URL(self.registration.scope).origin,
  });
}
