'use client';
import { useEffect, useState } from 'react';

/** يحتفظ بمعرف الطلب فقط في الجلسة، مع عزل المستخدم والشركة والنشاط عند إعادة فتح الصفحة. */
export function useImportRequest(companyId: string, businessId: string, userId: string) {
  const key = `employee-import:${companyId}:${businessId}:${userId}`;
  const [request, setRequest] = useState<{ key: string; id: string }>();
  useEffect(() => {
    const id = sessionStorage.getItem(key);
    setRequest(id === null ? undefined : { key, id });
  }, [key]);
  const accept = (id: string) => {
    sessionStorage.setItem(key, id);
    setRequest({ key, id });
  };
  return { previewId: request?.key === key ? request.id : undefined, accept };
}
