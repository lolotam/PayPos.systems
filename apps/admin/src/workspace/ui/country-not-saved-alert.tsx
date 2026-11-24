'use client';

import { t } from '@pospay/i18n';
import { Button, CircleAlert, EmptyState } from '@pospay/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Country } from '@pospay/contracts';

import { useLocale } from '@/shared/locale/locale-context';

import { setBusinessCountry } from '../api/create-business-client';
import { clearUnsavedCountry, readUnsavedCountry } from '../model/country-outcome';

/**
 * تنبيه دولة النشاط المشترك بين شاشتي أول نشاط وأول فرع: بيتولّد من سجل النتيجة بره الشاشة
 * (مفتاحه businessId) فبيعيش عبر تبديل الشاشات، و«حاول تاني» بيعيد الـ PUT لنفس النشاط
 * ونفس الشركة، والنجاح بيشيله، والتجاهل بيشيله كمان.
 */
export function CountryNotSavedAlert({ companyId, businessId }: { companyId: string; businessId: string }) {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [country, setCountry] = useState<Country | null>(() => readUnsavedCountry(businessId) ?? null);
  const [retrying, setRetrying] = useState(false);
  if (country === null) return null;
  async function retryCountry(): Promise<void> {
    if (country === null) return;
    setRetrying(true);
    try {
      await setBusinessCountry(companyId, businessId, country);
      clearUnsavedCountry(businessId);
      setCountry(null);
      void queryClient.invalidateQueries({ queryKey: ['me', 'workspaces'] });
    } catch {
      // فشل المحاولة التانية بيفضل التنبيه زي ما هو — المستخدم يقدر يعيد أو يتجاهل.
    } finally {
      setRetrying(false);
    }
  }
  function dismissCountry(): void {
    clearUnsavedCountry(businessId);
    setCountry(null);
  }
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-start">
      <EmptyState tone="danger" icon={<CircleAlert />} title={t(locale, 'admin.businessCountryNotSaved')} />
      <div className="flex flex-row gap-2">
        <Button type="button" size="sm" disabled={retrying} onClick={() => void retryCountry()}>
          {t(locale, 'admin.businessCountryRetry')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={dismissCountry}>
          {t(locale, 'admin.businessCountryDismiss')}
        </Button>
      </div>
    </div>
  );
}
