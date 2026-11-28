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
  const [clock, setClock] = useState(() => ({
    source: generatedAt,
    key,
    value: project(generatedAt),
  }));
  useEffect(() => {
    const startedAt = performance.now();
    startedRef.current = { source: generatedAt, startedAt };
    const timer = setInterval(() => {
      const instant = anchorInstant(generatedAt, startedAt);
      const activeKey = keyRef.current;
      setClock((previous) => {
        const value = projectRef.current(instant);
        return previous.source === generatedAt &&
          Object.is(previous.key, activeKey) &&
          Object.is(previous.value, value)
          ? previous
          : { source: generatedAt, key: activeKey, value };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [generatedAt]);
  if (clock.source === generatedAt && Object.is(clock.key, key)) {
    return clock.value;
  }
  const startedAt =
    startedRef.current.source === generatedAt ? startedRef.current.startedAt : performance.now();
  return project(anchorInstant(generatedAt, startedAt));
}
