'use client';
import { useEffect, useState } from 'react';

function readStoredRequest(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    // التخزين ممكن يكون مقفول؛ الاستيراد بيكمل، وبس إعادة فتح الصفحة مش هتلاقي الطلب.
    return null;
  }
}

function storeRequest(key: string, id: string): void {
  try {
    sessionStorage.setItem(key, id);
  } catch {
    // نفس الحالة: الطلب بيفضل في الذاكرة لحد ما الصفحة تتقفل.
  }
}

/** يحتفظ بمعرف الطلب فقط في الجلسة، مع عزل المستخدم والشركة والنشاط عند إعادة فتح الصفحة. */
export function useImportRequest(companyId: string, businessId: string, userId: string) {
  const key = `employee-import:${companyId}:${businessId}:${userId}`;
  const [request, setRequest] = useState<{ key: string; id: string }>();
  useEffect(() => {
    const id = readStoredRequest(key);
    setRequest(id === null ? undefined : { key, id });
  }, [key]);
  const accept = (id: string) => {
    storeRequest(key, id);
    setRequest({ key, id });
  };
  return { previewId: request?.key === key ? request.id : undefined, accept };
}
