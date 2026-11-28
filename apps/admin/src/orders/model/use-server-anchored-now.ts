'use client';
import { useEffect, useRef, useState } from 'react';

function anchorInstant(generatedAt: string, startedAt: number): string {
  const baseMs = Date.parse(generatedAt);
  if (!Number.isFinite(baseMs)) return generatedAt;
  return new Date(baseMs + Math.max(0, performance.now() - startedAt)).toISOString();
}

/**
 * يشتق قيمة متغيرة من ساعة الخادم بدل ساعة الجهاز، حتى تتفق حقول الزيارة على الوقت والتاريخ المحليين.
 * الاحتفاظ بالقيمة المشتقة السابقة يمنع تحديث الشاشة كل ثانية عندما لا تتغير النتيجة المرئية، كما يُعاد
 * حساب القيمة فوراً عند تغيّر المفتاح الاختياري بالاعتماد على اللحظة الحيّة المربوطة بساعة الخادم.
 *
 * @param generatedAt اللحظة التي أنشأ عندها الخادم سياق التسجيل
 * @param project دالة نقية تشتق القيمة المطلوبة من اللحظة الحالية
 * @param key مفتاح اختياري يُعيد تقييم اللحظة المربوطة فوراً عند تغيّره بين دورتي المؤقّت
 * @returns القيمة المشتقة من ساعة الخادم بعد إضافة الزمن المنقضي في المتصفح
 */
export function useServerAnchoredValue<T>(
  generatedAt: string,
  project: (instant: string) => T,
  key?: unknown,
): T {
  const projectRef = useRef(project);
  projectRef.current = project;
  const keyRef = useRef(key);
  keyRef.current = key;
  const startedRef = useRef({ source: generatedAt, startedAt: performance.now() });
  if (startedRef.current.source !== generatedAt) {
    startedRef.current = { source: generatedAt, startedAt: performance.now() };
  }
  const cacheRef = useRef<{ source: string; key: unknown; value: T } | null>(null);
  if (
    cacheRef.current === null ||
    cacheRef.current.source !== generatedAt ||
    !Object.is(cacheRef.current.key, key)
  ) {
    cacheRef.current = {
      source: generatedAt,
      key,
      value: project(anchorInstant(generatedAt, startedRef.current.startedAt)),
    };
  }
  const [, setClock] = useState(cacheRef.current);
  useEffect(() => {
    const startedAt =
      startedRef.current.source === generatedAt ? startedRef.current.startedAt : performance.now();
    startedRef.current = { source: generatedAt, startedAt };
    const timer = setInterval(() => {
      const instant = anchorInstant(generatedAt, startedAt);
      const activeKey = keyRef.current;
      const value = projectRef.current(instant);
      const current = cacheRef.current;
      if (
        current !== null &&
        current.source === generatedAt &&
        Object.is(current.key, activeKey) &&
        Object.is(current.value, value)
      ) {
        return;
      }
      const next = { source: generatedAt, key: activeKey, value };
      cacheRef.current = next;
      setClock(next);
    }, 1000);
    return () => clearInterval(timer);
  }, [generatedAt]);
  return cacheRef.current.value;
}
