'use client';
import type { CustomerProfile } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLayoutEffect, useState } from 'react';

import {
  useSessionCustomerProfile,
  type SessionCustomerProfileEntry,
} from '../api/use-session-customer-profile';
import { serviceSessionAccessRevoked } from '../model/service-session-access';
import { ProfileField } from './profile-field';

type SessionCustomerProfileCardProps = SessionCustomerProfileEntry & {
  locale: Locale;
  /** null = hydration لم تكتمل؛ لا قراءة ولا حجب دائم في هذه الحالة. */
  online?: boolean | null;
  onAccessDenied?: (() => void) | undefined;
};

function birthdayText(birthday: CustomerProfile['birthday']): string | null {
  if (birthday === null) return null;
  const dayAndMonth = `${birthday.day}/${birthday.month}`;
  return birthday.year === null ? dayAndMonth : `${dayAndMonth}/${birthday.year}`;
}

function noteBusinessName(note: CustomerProfile['notes'][number], locale: Locale): string {
  return (locale === 'ar' && note.business_name_ar) || note.business_name_en;
}

// لو القراءة اتوقفت أو فشلت، رجوع النت ما يعيدهاش لوحده؛ المستخدم يضغط Retry أو يختار زبونة تانية.
// ضبط الحالة أثناء الرندر هو نمط React الموصى به لتغيّر props، ويتجنّب setState في effect.
function useProfileReadGate(online: boolean | null, customerId: string | null) {
  // اختيار ظهر وهو offline لازم يفضل محجوب لحد Retry؛ hydration مجهولة ما تحجبش دائماً.
  const [blocked, setBlocked] = useState(online === false);
  const [previousCustomer, setPreviousCustomer] = useState(customerId);
  const [previousOnline, setPreviousOnline] = useState(online);
  if (previousCustomer !== customerId) {
    setPreviousCustomer(customerId);
    setBlocked(online === false);
  }
  if (previousOnline !== online) {
    setPreviousOnline(online);
    if (online === false) setBlocked(true);
  }
  return { canRead: online === true && !blocked, blocked, unblock: () => setBlocked(false) };
}

export function SessionCustomerProfileCard({ locale, online = true, onAccessDenied, ...entry }: SessionCustomerProfileCardProps) {
  const { canRead, blocked, unblock } = useProfileReadGate(online, entry.customerId);
  const query = useSessionCustomerProfile(entry, canRead);
  // رفض صريح للوصول لازم يلغي اختيار البيع فوراً ويعيد فحص السياق؛ الفشل العادي يفضل زي ما هو.
  useLayoutEffect(() => { if (serviceSessionAccessRevoked(query.error)) onAccessDenied?.(); }, [query.error, onAccessDenied]);
  const retry = () => {
    if (online !== true || !navigator.onLine) return;
    if (blocked) unblock();
    else void query.refetch();
  };
  if (query.isError)
    return (
      <div role="alert" className="flex flex-col gap-2">
        <p>{t(locale, 'serviceSessions.profileLoadFailed')}</p>
        <Button type="button" disabled={online !== true} onClick={retry}>
          {t(locale, 'serviceSessions.profileRetry')}
        </Button>
      </div>
    );
  const profile = query.data;
  if (profile === undefined)
    return (
      <div className="flex flex-col gap-2">
        <p aria-live="polite">
          {t(locale, canRead ? 'serviceSessions.profileLoading' : 'serviceSessions.profileOffline')}
        </p>
        {canRead ? null : (
          <Button type="button" disabled={online !== true} onClick={retry}>
            {t(locale, 'serviceSessions.profileRetry')}
          </Button>
        )}
      </div>
    );
  const empty = t(locale, 'serviceSessions.profileEmpty');
  const gender =
    profile.gender === null
      ? null
      : t(locale, profile.gender === 'female' ? 'serviceSessions.genderFemale' : 'serviceSessions.genderMale');
  return (
    <section aria-label={t(locale, 'serviceSessions.profileCard')} className="flex flex-col gap-1">
      <ProfileField label={t(locale, 'serviceSessions.name')} value={profile.name} empty={empty} />
      <ProfileField label={t(locale, 'serviceSessions.phone')} value={profile.phone} empty={empty} ltr />
      <ProfileField label={t(locale, 'serviceSessions.gender')} value={gender} empty={empty} />
      <ProfileField label={t(locale, 'serviceSessions.birthday')} value={birthdayText(profile.birthday)} empty={empty} />
      <ProfileField label={t(locale, 'serviceSessions.email')} value={profile.email} empty={empty} />
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
