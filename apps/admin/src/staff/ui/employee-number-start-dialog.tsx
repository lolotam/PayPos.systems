'use client';
import { useEmployeeNumbering } from '../api/use-employee-numbering';
import { EmployeeNumberStartForm } from './employee-number-start-form';

export function EmployeeNumberStartDialog({
  companyId,
  userId,
}: {
  companyId: string;
  userId: string;
}) {
  const query = useEmployeeNumbering(companyId, userId);
  if (!query.data?.can_manage) return null;
  return (
    <dialog
      open
      aria-labelledby="employee-number-start-title"
      className="w-full max-w-lg rounded-xl border border-border bg-card p-6 text-start text-card-foreground"
    >
      <EmployeeNumberStartForm
        companyId={companyId}
        userId={userId}
        nextNumber={query.data.next_number}
      />
    </dialog>
  );
}
