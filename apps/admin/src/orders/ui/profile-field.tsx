'use client';

export function ProfileField({
  label,
  value,
  empty,
  ltr = false,
}: {
  label: string;
  value: string | null;
  empty: string;
  ltr?: boolean;
}) {
  return (
    <p>
      <b>{label}</b> {value === null ? empty : ltr ? <bdi dir="ltr">{value}</bdi> : value}
    </p>
  );
}
