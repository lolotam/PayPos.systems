'use client';
import type { ServiceCategoriesQuery } from '../api/use-service-categories';
import { useState } from 'react';

/**
 * حالة صفحة الخدمات: مؤشر الصفحة والخدمة المختارة والتصنيف المختار، مع
 * إسقاط الاختيار والتقسيم كلما تغيّر أحدهما عشان الشاشة تظل متسقة مع الصفوف.
 */
export function useServicesPageState(categoryQuery: ServiceCategoriesQuery) {
  const [cursor, setCursor] = useState<string>();
  const [serviceId, setServiceId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  // التصنيف المختار ممكن يختفي من القائمة بعد إعادة الجلب، فنبعث الطلب بدون تصنيف
  // عشان ما يبقاش الاختيار الظاهر على الشاشة مخالف للصفوف المعروضة.
  const activeCategoryId =
    categoryQuery.data && !categoryQuery.data.some((category) => category.id === categoryId)
      ? ''
      : categoryId;
  const page = (next: string | undefined) => {
    setCursor(next);
    setServiceId('');
  };
  const filter = (nextCategoryId: string) => {
    setCategoryId(nextCategoryId);
    setCursor(undefined);
    setServiceId('');
  };
  return { cursor, serviceId, setServiceId, activeCategoryId, page, filter };
}
