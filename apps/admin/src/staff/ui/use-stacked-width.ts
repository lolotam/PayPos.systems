'use client';
import { useSyncExternalStore } from 'react';

// نفس شرط Tailwind لـ max-[599.99px]: أصغر تمامًا من 599.99px، حتى لا يختلف الإطار عن الخاصية عند التساوي.
const STACKED_QUERY = '(width < 599.99px)';

const subscribers = new Set<() => void>();
const beforeChange = new Set<() => void>();
let media: MediaQueryList | undefined;

// مستمع واحد على كائن MediaQueryList واحد لكل الوحدة: المتصفح يطلق «change» لكل كائن بترتيب إنشائه
// ويفرّغ المهام الدقيقة (ومعها رسم React) بعد كل مستمع، فمع كائنين يسبق الرسمُ الكائنَ الثاني.
// بمستمع واحد يجري ما يسبق الإخطار أولًا، ثم يُخطَر المشتركون، فلا يسبق الرسمُ اللقطةَ أبدًا.
function onMediaChange() {
  beforeChange.forEach((run) => run());
  subscribers.forEach((notify) => notify());
}

function attach() {
  if (media || typeof window.matchMedia !== 'function') return;
  media = window.matchMedia(STACKED_QUERY);
  media.addEventListener('change', onMediaChange);
}

function detachWhenIdle() {
  if (!media || subscribers.size > 0 || beforeChange.size > 0) return;
  media.removeEventListener('change', onMediaChange);
  media = undefined;
}

function register(group: Set<() => void>, run: () => void) {
  attach();
  group.add(run);
  return () => {
    group.delete(run);
    detachWhenIdle();
  };
}

function subscribe(notify: () => void) {
  return register(subscribers, notify);
}

/** هل العرض الحالي مكدّس الآن؟ يُقرأ طازجًا، فيصلح داخل مستمع التغيير نفسه. */
export function isStackedWidth() {
  return typeof window.matchMedia === 'function' && window.matchMedia(STACKED_QUERY).matches;
}

/**
 * يسجّل عملًا يجري عند تغيّر العرض قبل إخطار أي مشترك في useStackedWidth، فيرى الوضع السابق للصفحة
 * (التركيز مثلًا) لا ما بعد رسم React. يعيد دالة الإلغاء.
 */
export function onBeforeStackedChange(run: () => void) {
  return register(beforeChange, run);
}

/**
 * هل الشاشة بعرض الصفوف المكدسة (تحت 600px)؟ الإطار يخفي ترويسة الجدول بصريًا هناك،
 * فلا تُرسم فيها أزرار فرز. الخادم والمتصفح بلا matchMedia: خطأ.
 */
export function useStackedWidth(): boolean {
  return useSyncExternalStore(subscribe, isStackedWidth, () => false);
}
