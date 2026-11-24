'use client';

import type { Branch, Business, Country, WorkspaceCompanyRead } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';

import { isUndecided } from '../model/create-company-attempt';
import { clearUnsavedCountry, writeUnsavedCountry } from '../model/country-outcome';
import { createBranch, type CreateBranchWire } from './create-branch-client';
import { createBusiness, setBusinessCountry, type CreateBusinessWire } from './create-business-client';
import { fetchWorkspaces } from './use-workspaces';

/** نتيجة إنشاء النشاط: النشاط المنشأ وهل دولته اتحفظت — فشل الـ PUT مش بيفشل الإنشاء. */
export type CreateBusinessOutcome = { created: Business; countrySaved: boolean };

/**
 * المفتاح الماسك داخل التركيب الواحد: نفس القيم بعد جواب غير محسوم (شبكة أو 5xx/408/409/429)
 * بيعيدوا نفس المفتاح، وجواب قاطع أو قيم متغيرة بيولّدوا مفتاح جديد. مفيش تخزين زي شاشة
 * الشركة (077) — نموذج الشاشة هو اللي بيحمل القيم فإعادة الإرسال بيحصل منها نفسها.
 */
type HeldKey = { key: string; signature: string; decided: boolean };

function holdKey(held: HeldKey | null, signature: string): string {
  const reusable = held !== null && !held.decided && held.signature === signature;
  return reusable ? held.key : crypto.randomUUID();
}

/**
 * حرس التكرار قبل أي POST: قراءة واحدة محدّثة لمساحات العمل (staleTime صفر عشان تتجاوز الكاش
 * الطازج). القراءة بتنزل في الكاش نفسه، فلو الحرس لقى اللي بيدوّر عليه المزوّد بينتقل للخطوة
 * اللي بعدها لوحده من غير invalidation تانية.
 */
async function freshCompany(
  client: ReturnType<typeof useQueryClient>,
  companyId: string,
): Promise<WorkspaceCompanyRead | undefined> {
  const read = await client.fetchQuery({
    queryKey: ['me', 'workspaces'],
    queryFn: fetchWorkspaces,
    staleTime: 0,
    // أوفلاين بيفشل فورًا بدل ما يترصّن: الفشل بيرجع للشاشة بلا إرسال.
    networkMode: 'always',
  });
  return read.companies.find((company) => company.id === companyId);
}

/** بينشئ أول نشاط للشركة: POST واحد بمفتاح Idempotency وبعده PUT لدولة النشاط المنشأ. */
export function useCreateBusiness(companyId: string) {
  const client = useQueryClient();
  const held = useRef<HeldKey | null>(null);
  return useMutation({
    mutationKey: ['businesses', 'create', companyId],
    retry: false,
    gcTime: 0,
    // عند انقطاع الاتصال الطلب بيفشل فورًا كفشل شبكة بدل ما يترصّن صامتًا.
    networkMode: 'always',
    mutationFn: async ({
      body,
      country,
    }: {
      body: CreateBusinessWire;
      country: Country;
    }): Promise<CreateBusinessOutcome | null> => {
      const company = await freshCompany(client, companyId);
      // الشركة اختفت من القراءة المحدّثة (اتشالت العضوية أو الشركة) أو بقى ليها نشاط: مفيش POST
      // — العرض بينتقل حسب القراءة الجديدة نفسها، وفشل القراءة نفسه بيرجع خطأ عادي.
      if (company === undefined || company.businesses.length > 0) return null;
      const signature = JSON.stringify(body);
      const key = holdKey(held.current, signature);
      held.current = { key, signature, decided: false };
      let created: Business;
      try {
        created = await createBusiness(companyId, key, body);
      } catch (error) {
        held.current = { key, signature, decided: !isUndecided(error) };
        throw error;
      }
      let countrySaved = true;
      try {
        await setBusinessCountry(companyId, created.id, country);
      } catch {
        // فشل تحديد الدولة بعد إنشاء ناجح مش بيرجع لورا ولا بيعيد الـ POST: النشاط موجود
        // والدولة تنحفظ لاحقًا من الإعدادات، والانسياب بيكمل للخطوة اللي بعدها. النتيجة
        // بتتعيش بره الشاشة عشان تنبيه شاشة أول فرع يلحقها.
        countrySaved = false;
        writeUnsavedCountry(created.id, country);
      }
      if (countrySaved) clearUnsavedCountry(created.id);
      held.current = { key, signature, decided: true };
      // من غير await عشان تنبيه «الدولة ما اتحفظتش» يلحق يظهر قبل ما القراءة المحدّثة تبدّل الشاشة.
      void client.invalidateQueries({ queryKey: ['me', 'workspaces'] });
      return { created, countrySaved };
    },
  });
}

/** بينشئ أول فرع للنشاط المختار: POST واحد بمفتاح Idempotency على مسار النشاط. */
export function useCreateBranch(companyId: string, businessId: string) {
  const client = useQueryClient();
  const held = useRef<HeldKey | null>(null);
  return useMutation({
    mutationKey: ['branches', 'create', businessId],
    retry: false,
    gcTime: 0,
    networkMode: 'always',
    mutationFn: async (body: CreateBranchWire): Promise<Branch | null> => {
      const company = await freshCompany(client, companyId);
      const business = company?.businesses.find((candidate) => candidate.id === businessId);
      // النشاط اللي اختفى من القراءة المحدّثة بيتعامل معاه زي ما بقى ليه فروع: مفيش POST،
      // والعرض بينتقل حسب القراءة الجديدة نفسها.
      if (business === undefined || business.branches.length > 0) return null;
      const signature = JSON.stringify(body);
      const key = holdKey(held.current, signature);
      held.current = { key, signature, decided: false };
      try {
        const created = await createBranch(companyId, key, businessId, body);
        held.current = { key, signature, decided: true };
        void client.invalidateQueries({ queryKey: ['me', 'workspaces'] });
        return created;
      } catch (error) {
        held.current = { key, signature, decided: !isUndecided(error) };
        throw error;
      }
    },
  });
}
