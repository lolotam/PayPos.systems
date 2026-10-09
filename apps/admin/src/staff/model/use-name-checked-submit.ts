'use client';
import type {
  EmployeeDetail,
  EmployeeNameMatches,
  EmployeeNameMatchesInput,
} from '@pospay/contracts';
import { useEffect, useRef, useState } from 'react';
import { useEmployeeNameMatches } from '../api/use-employee-name-matches';

type PendingSubmission<T> = { terms: T; matches: EmployeeNameMatches; scope: string };

async function checkNames(
  check: (input: EmployeeNameMatchesInput) => Promise<EmployeeNameMatches>,
  terms: EmployeeNameMatchesInput,
  employeeId?: string,
) {
  try {
    return await check({
      name_en: terms.name_en,
      name_ar: terms.name_ar,
      ...(employeeId ? { exclude_employee_id: employeeId } : {}),
    });
  } catch {
    // التنبيه استشاري؛ فشل القراءة لا يمنع الحفظ ولا يعيد محاولة الكتابة.
    return undefined;
  }
}

export function useNameCheckedSubmit<T extends EmployeeNameMatchesInput>(
  companyId: string,
  businessId: string,
  onSave: (terms: T) => void,
  record?: EmployeeDetail,
) {
  const check = useEmployeeNameMatches(companyId, businessId);
  const scope = `${companyId}:${businessId}:${record?.id ?? ''}`;
  const active = useRef<object | null>(null);
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState<PendingSubmission<T> | null>(null);
  useEffect(() => {
    active.current = null;
    setPending(null);
    setChecking(false);
    return () => {
      active.current = null;
    };
  }, [scope]);
  const warning = pending?.scope === scope ? pending : null;
  const submit = async (terms: T) => {
    if (active.current || warning) return;
    if (
      record &&
      terms.name_en.trim() === record.name_en.trim() &&
      (terms.name_ar ?? '').trim() === (record.name_ar ?? '').trim()
    ) {
      onSave(terms);
      return;
    }
    const attempt = {};
    active.current = attempt;
    setChecking(true);
    const matches = await checkNames(check.mutateAsync, terms, record?.id);
    if (active.current !== attempt) return;
    active.current = null;
    setChecking(false);
    if (matches && (matches.visible_total > 0 || matches.hidden_exists)) {
      setPending({ terms, matches, scope });
    } else onSave(terms);
  };
  const confirm = () => {
    if (!warning || active.current) return;
    active.current = {};
    setPending(null);
    try {
      onSave(warning.terms);
    } finally {
      active.current = null;
    }
  };
  const dismiss = () => {
    setPending(null);
    requestAnimationFrame(() => document.getElementById('employee-name-ar')?.focus());
  };
  return { submit, confirm, dismiss, checking, warning: warning?.matches ?? null };
}
