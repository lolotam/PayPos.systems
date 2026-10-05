'use client';
import type { EmployeeImportPreview } from '@pospay/contracts';
import type { UseMutationResult } from '@tanstack/react-query';
import { useRef, useState } from 'react';

type PreviewMutation = Pick<
  UseMutationResult<EmployeeImportPreview, unknown, File>,
  'mutate' | 'reset'
>;

/** هوية الاختيار تمنع استجابة ملف سابق من إتاحة حفظه بعد اختيار ملف جديد، حتى لو أعيد نفس File. */
export function useImportSelection(preview: PreviewMutation, commit: { reset(): void }) {
  const [file, setFile] = useState<File>();
  const [result, setResult] = useState<EmployeeImportPreview>();
  const selection = useRef<object | undefined>(undefined);
  const select = (next?: File) => {
    selection.current = {};
    setFile(next);
    setResult(undefined);
    preview.reset();
    commit.reset();
  };
  const inspect = () => {
    if (file === undefined) return;
    const current = selection.current;
    setResult(undefined);
    preview.mutate(file, {
      onSuccess: (data) => {
        if (selection.current === current) setResult(data);
      },
    });
  };
  return { file, select, inspect, result };
}
