'use client';
import { useEffect, useRef, useState } from 'react';

function anchorInstant(generatedAt: string, startedAt: number): string {
  const baseMs = Date.parse(generatedAt);
  if (!Number.isFinite(baseMs)) return generatedAt;
  return new Date(baseMs + Math.max(0, performance.now() - startedAt)).toISOString();
}

interface AnchoredClock<T> {
  source: string;
  startedAt: number;
  key: unknown;
  value: T;
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
  const [clock, setClock] = useState<AnchoredClock<T>>(() => {
    const startedAt = performance.now();
    return {
      source: generatedAt,
      startedAt,
      key,
      value: project(anchorInstant(generatedAt, startedAt)),
    };
  });
  let active = clock;
  if (clock.source !== generatedAt || !Object.is(clock.key, key)) {
    const startedAt = clock.source === generatedAt ? clock.startedAt : performance.now();
    active = {
      source: generatedAt,
      startedAt,
      key,
      value: project(anchorInstant(generatedAt, startedAt)),
    };
    setClock(active);
  }
  useEffect(() => {
    projectRef.current = project;
  });
  useEffect(() => {
    const timer = setInterval(() => {
      setClock((current) => {
        if (current.source !== generatedAt) return current;
        const value = projectRef.current(anchorInstant(generatedAt, current.startedAt));
        return Object.is(current.value, value) ? current : { ...current, value };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [generatedAt]);
  return active.value;
}
