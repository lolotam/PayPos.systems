import type { MembershipPermissions } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { PermissionOverrides } from './permission-overrides';
import { PermissionPageNavigation } from './permission-page-navigation';

type Props = {
  data: MembershipPermissions;
  branchTimeZones: Readonly<Record<string, string>>;
  cursor: string | undefined;
  onCursorChange: (cursor: string | undefined) => void;
};

export function PermissionMembershipHistory({
  data,
  branchTimeZones,
  cursor,
  onCursorChange,
}: Props) {
  const locale = useLocale();
  return (
    <section className="flex flex-col gap-2 rounded-card border border-border bg-secondary/50 p-4 text-muted-foreground">
      <h2 className="font-bold">{t(locale, 'permissions.history')}</h2>
      <PermissionOverrides
        items={data.ended_overrides.items}
        branchTimeZones={branchTimeZones}
        ended
      />
      <PermissionPageNavigation
        cursor={cursor}
        next={data.ended_overrides.next_cursor}
        onChange={onCursorChange}
      />
    </section>
  );
}
