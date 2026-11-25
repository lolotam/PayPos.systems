'use client';
import { useCallback, useEffect, useState } from 'react';

/** مفتاح متابعة الطلب في الجلسة: الشركة والنشاط والمستخدم بيحموا الطلب من غيرهم. */
function resumeKey(companyId: string, businessId: string, userId: string): string {
  return `service-import:${companyId}:${businessId}:${userId}`;
}

function readStored(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    // التخزين ممكن يكون مقفول؛ الاستيراد بيكمل، وبس إعادة فتح الصفحة مش هتلاقي الطلب.
    return null;
  }
}

function storeResume(key: string, previewId: string): void {
  try {
    sessionStorage.setItem(key, previewId);
  } catch {
    // نفس الحالة: الطلب بيفضل في الذاكرة لحد ما الصفحة تتقفل.
  }
}

function clearResume(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // نفس الحالة: الطلب بيفضل في الذاكرة لحد ما الصفحة تتقفل.
  }
}

/**
 * اختيار الملف ومتابعة الطلب المقبول: معرّف المعاينة المحفوظ في الجلسة يُستأنف عند
 * إعادة فتح الصفحة، ويمسح عند تغيير الملف أو عند نتيجة نهائية.
 */
export function useServiceImportSelection(companyId: string, businessId: string, userId: string) {
  const key = resumeKey(companyId, businessId, userId);
  const [file, setFile] = useState<File>();
  const [resumedPreviewId, setResumedPreviewId] = useState<string>();
  useEffect(() => {
    const stored = readStored(key);
    setResumedPreviewId(stored ?? undefined);
  }, [key]);
  const select = useCallback(
    (next?: File) => {
      clearResume(key);
      setResumedPreviewId(undefined);
      setFile(next);
    },
    [key],
  );
  const remember = useCallback(
    (previewId: string) => {
      storeResume(key, previewId);
      setResumedPreviewId(previewId);
    },
    [key],
  );
  // نتيجة نهائية: المسح من الجلسة بس، والمعرّف يفضل في الذاكرة عشان النتيجة تظل معروضة.
  const release = useCallback(() => {
    clearResume(key);
  }, [key]);
  return { file, select, remember, release, resumedPreviewId };
}
