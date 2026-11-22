'use client';
import type { CustomerProfile } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';

import {
  useSessionCustomerProfile,
  type SessionCustomerProfileEntry,
} from '../api/use-session-customer-profile';

type SessionCustomerProfileCardProps = SessionCustomerProfileEntry & {
  locale: Locale;
  online?: boolean;
};

function birthdayText(birthday: CustomerProfile['birthday']): string | null {
  if (birthday === null) return null;
  const dayAndMonth = `${birthday.day}/${birthday.month}`;
  return birthday.year === null ? dayAndMonth : `${dayAndMonth}/${birthday.year}`;
}

function noteBusinessName(note: CustomerProfile['notes'][number], locale: Locale): string {
  return (locale === 'ar' && note.business_name_ar) || note.business_name_en;
}

function Field({
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

// لو القراءة اتوقفت أو فشلت، رجوع النت ما يعيدهاش لوحده؛ المستخدم يضغط Retry أو يختار زبونة تانية.
// ضبط الحالة أثناء الرندر هو نمط React الموصى به لتغيّر props، ويتجنّب setState في effect.
function useProfileReadGate(online: boolean, customerId: string | null) {
  const [blocked, setBlocked] = useState(false);
  const [previousCustomer, setPreviousCustomer] = useState(customerId);
  const [previousOnline, setPreviousOnline] = useState(online);
  if (previousCustomer !== customerId) {
    setPreviousCustomer(customerId);
    setBlocked(false);
  }
  if (previousOnline !== online) {
    setPreviousOnline(online);
    if (!online) setBlocked(true);
  }
  return { canRead: online && !blocked, blocked, unblock: () => setBlocked(false) };
}

export function SessionCustomerProfileCard({ locale, online = true, ...entry }: SessionCustomerProfileCardProps) {
  const { canRead, blocked, unblock } = useProfileReadGate(online, entry.customerId);
  const query = useSessionCustomerProfile(entry, canRead);
  const retry = () => {
    if (blocked) unblock();
    else void query.refetch();
  };
  if (query.isError)
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>{t(locale, 'serviceSessions.profileLoadFailed')}</p>
        <Button type="button" disabled={!online} onClick={retry}>
          {t(locale, 'serviceSessions.profileRetry')}
        </Button>
      </div>
    );
  const profile = query.data;
  if (profile === undefined)
    return (
      <p aria-live="polite">
        {t(locale, canRead ? 'serviceSessions.profileLoading' : 'serviceSessions.profileOffline')}
      </p>
    );
  const birthday = birthdayText(profile.birthday);
  const empty = t(locale, 'serviceSessions.profileEmpty');
  const gender =
    profile.gender === null
      ? null
      : t(locale, profile.gender === 'female' ? 'serviceSessions.genderFemale' : 'serviceSessions.genderMale');
  return (
    <section aria-label={t(locale, 'serviceSessions.profileCard')} className="flex flex-col gap-1">
      <Field label={t(locale, 'serviceSessions.name')} value={profile.name} empty={empty} />
      <Field label={t(locale, 'serviceSessions.phone')} value={profile.phone} empty={empty} ltr />
      <Field label={t(locale, 'serviceSessions.gender')} value={gender} empty={empty} />
      <Field label={t(locale, 'serviceSessions.birthday')} value={birthday} empty={empty} />
      <Field label={t(locale, 'serviceSessions.email')} value={profile.email} empty={empty} />
      {profile.notes.length === 0 ? (
        <p>{t(locale, 'serviceSessions.profileNoNotes')}</p>
      ) : (
        <ul>
          {profile.notes.map((note) => (
            <li key={`${note.business_id}-${note.created_at}`}>
              <b>{t(locale, 'serviceSessions.profileNoteFrom')}</b>{' '}
              <span>{noteBusinessName(note, locale)}</span>
              <p className="whitespace-pre-wrap">{note.note}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
