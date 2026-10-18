'use client';
import type { CreateEmployeeInput } from '@pospay/contracts';
import { useEffect, useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeNumberCapability } from '../api/use-employee-number-capability';
import {
  isEmployeeNumberRefusal,
  typedEmployeeNumber,
  withEmployeeNumber,
} from './typed-employee-number';

type NumberDraft = {
  companyId: string;
  businessId: string;
  userId: string;
  branchId: string;
  serverError: unknown;
  onVisibility: ((shown: boolean) => void) | undefined;
};

export function saveParsedEmployeeNumber(
  apply: (values: CreateEmployeeInput) => CreateEmployeeInput | null,
  submit: (values: CreateEmployeeInput) => void,
) {
  return (values: CreateEmployeeInput) => {
    const next = apply(values);
    if (next) submit(next);
  };
}

export function useCreateEmployeeNumber({
  companyId,
  businessId,
  userId,
  branchId,
  serverError,
  onVisibility,
}: NumberDraft) {
  const locale = useLocale();
  const capability = useEmployeeNumberCapability(companyId, businessId, userId, branchId);
  const shown = capability.data?.can_type_number === true;
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (!shown) setDraft('');
  }, [shown]);
  useEffect(() => {
    onVisibility?.(shown);
  }, [onVisibility, shown]);
  const changeDraft = (value: string) => {
    setDraft(value);
    setInvalid(false);
  };
  const apply = (values: CreateEmployeeInput) => {
    if (!shown) return withEmployeeNumber(values, undefined);
    const parsed = typedEmployeeNumber(draft);
    if (parsed === null) {
      setInvalid(true);
      return null;
    }
    setInvalid(false);
    return withEmployeeNumber(values, parsed);
  };
  const message =
    shown && isEmployeeNumberRefusal(serverError) ? envelopeMessage(serverError, locale) : null;
  return { shown, draft, invalid, message, changeDraft, apply };
}
