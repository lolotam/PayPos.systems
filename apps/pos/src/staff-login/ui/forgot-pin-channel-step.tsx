import { useState } from 'react';
import type { StaffPinResetRequestInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button, Input, Label, NativeSelect } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

type Channel = StaffPinResetRequestInput['channel'];

const CHOICES = [
  ['EMAIL', 'staffLogin.forgotPinChannelEmail'],
  ['WHATSAPP', 'staffLogin.forgotPinChannelWhatsapp'],
] as const;

type ForgotPinChannelStepProps = {
  pending: boolean;
  onSubmit: (input: StaffPinResetRequestInput) => Promise<void>;
};

function ChannelSelector({
  locale,
  channel,
  pending,
  onSelect,
}: {
  locale: Locale;
  channel: Channel;
  pending: boolean;
  onSelect: (channel: Channel) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={t(locale, 'staffLogin.forgotPinTitle')}
      className="flex gap-2"
    >
      {CHOICES.map(([value, key]) => (
        <Button
          key={value}
          size="touch"
          type="button"
          role="radio"
          aria-checked={channel === value}
          variant={channel === value ? 'default' : 'outline'}
          disabled={pending}
          onClick={() => onSelect(value)}
        >
          {t(locale, key)}
        </Button>
      ))}
    </div>
  );
}

export function ForgotPinChannelStep({ pending, onSubmit }: ForgotPinChannelStepProps) {
  const locale = useLocale();
  const [channel, setChannel] = useState<Channel>('EMAIL');
  const [identifier, setIdentifier] = useState('');
  const [language, setLanguage] = useState<StaffPinResetRequestInput['locale']>(locale);
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({ channel, identifier: identifier.trim(), locale: language });
      }}
    >
      <ChannelSelector locale={locale} channel={channel} pending={pending} onSelect={setChannel} />
      <Label className="text-base" htmlFor="forgot-pin-identifier">
        {t(locale, channel === 'EMAIL' ? 'staffLogin.forgotPinEmail' : 'staffLogin.phone')}
      </Label>
      <Input
        id="forgot-pin-identifier"
        dir="ltr"
        type={channel === 'EMAIL' ? 'email' : 'tel'}
        autoComplete="off"
        disabled={pending}
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
      />
      <Label className="text-base" htmlFor="forgot-pin-language">
        {t(locale, 'staffLogin.language')}
      </Label>
      <NativeSelect
        id="forgot-pin-language"
        disabled={pending}
        value={language}
        onChange={(event) => setLanguage(event.target.value === 'en' ? 'en' : 'ar')}
      >
        <option value="ar">{t(locale, 'staffLogin.arabic')}</option>
        <option value="en">{t(locale, 'staffLogin.english')}</option>
      </NativeSelect>
      <Button size="touch" type="submit" disabled={pending}>
        {t(locale, 'staffLogin.forgotPinSend')}
      </Button>
    </form>
  );
}
