'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * يشتق قيمة متغيرة من ساعة الخادم بدل ساعة الجهاز، حتى تتفق حقول الزيارة على الوقت والتاريخ المحليين.
 * الاحتفاظ بالقيمة المشتقة السابقة يمنع تحديث الشاشة كل ثانية عندما لا تتغير النتيجة المرئية.
 *
 * @param generatedAt اللحظة التي أنشأ عندها الخادم سياق التسجيل
 * @param project دالة نقية تشتق القيمة المطلوبة من اللحظة الحالية
 * @returns القيمة المشتقة من ساعة الخادم بعد إضافة الزمن المنقضي في المتصفح
 */
export function useServerAnchoredValue<T>(generatedAt: string, project: (instant: string) => T): T {
  const projectRef = useRef(project);
  projectRef.current = project;
  const [clock, setClock] = useState(() => ({ source: generatedAt, value: project(generatedAt) }));
  useEffect(() => {
    const started = performance.now();
    const timer = setInterval(() => {
      const instant = new Date(Date.parse(generatedAt) + (performance.now() - started)).toISOString();
      setClock((previous) => {
        const value = projectRef.current(instant);
        return previous.source === generatedAt && Object.is(previous.value, value)
          ? previous : { source: generatedAt, value };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [generatedAt]);
  return clock.source === generatedAt ? clock.value : project(generatedAt);
}
