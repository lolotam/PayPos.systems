'use client';
import type { CustomerProfile } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';

import {
  useSessionCustomerProfile,
  type SessionCustomerProfileEntry,
} from '../api/use-session-customer-profile';

type SessionCustomerProfileCardProps = SessionCustomerProfileEntry & { locale: Locale };

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
}: {
  label: string;
  value: string | null;
  empty: string;
}) {
  return (
    <p>
      <b>{label}</b> {value ?? empty}
    </p>
  );
}

export function SessionCustomerProfileCard({ locale, ...entry }: SessionCustomerProfileCardProps) {
  const query = useSessionCustomerProfile(entry);
  if (query.isError)
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>{t(locale, 'serviceSessions.profileLoadFailed')}</p>
        <Button type="button" onClick={() => void query.refetch()}>
          {t(locale, 'serviceSessions.profileRetry')}
        </Button>
      </div>
    );
  const profile = query.data;
  if (profile === undefined)
    return <p aria-live="polite">{t(locale, 'serviceSessions.profileLoading')}</p>;
  const birthday = birthdayText(profile.birthday);
  const empty = t(locale, 'serviceSessions.profileEmpty');
  const gender =
    profile.gender === null
      ? null
      : t(locale, profile.gender === 'female' ? 'serviceSessions.genderFemale' : 'serviceSessions.genderMale');
  return (
    <section aria-label={t(locale, 'serviceSessions.profileCard')} className="flex flex-col gap-1">
      <Field label={t(locale, 'serviceSessions.name')} value={profile.name} empty={empty} />
      <Field label={t(locale, 'serviceSessions.phone')} value={profile.phone} empty={empty} />
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
              <p>{note.note}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
