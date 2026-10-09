'use client';
import type { EmployeeNameMatches, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

type WarningProps = {
  matches: EmployeeNameMatches;
  branches: readonly WorkspaceBranch[];
  onEdit: () => void;
  onConfirm: () => void;
};

export function DuplicateNameWarning({ matches, branches, onEdit, onConfirm }: WarningProps) {
  const locale = useLocale();
  return (
    <section
      role="alert"
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      className="flex flex-col gap-3 rounded-xl border p-4 text-start"
    >
      <h2 className="font-semibold">{t(locale, 'staff.duplicateNameTitle')}</h2>
      <p>{t(locale, 'staff.duplicateNameLead')}</p>
      {matches.matches.length > 0 ? (
        <ul className="list-disc ps-5">
          {matches.matches.map((match) => {
            const branch = branches.find((item) => item.id === match.primary_branch_id);
            return (
              <li key={match.id}>
                <bdi>{match.name_en}</bdi>
                {match.name_ar ? (
                  <>
                    {' '}
                    · <bdi>{match.name_ar}</bdi>
                  </>
                ) : null}
                {branch ? (
                  <>
                    {' '}
                    ·{' '}
                    <bdi>
                      {locale === 'ar' ? (branch.name_ar ?? branch.name_en) : branch.name_en}
                    </bdi>
                  </>
                ) : null}
                {' · '}
                {t(locale, `roles.${match.role_code}`)}
              </li>
            );
          })}
        </ul>
      ) : null}
      {matches.hidden_exists ? <p>{t(locale, 'staff.duplicateNameHidden')}</p> : null}
      {matches.visible_total > matches.matches.length ? (
        <p>
          {t(locale, 'staff.duplicateNameMore')} {matches.visible_total - matches.matches.length}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={onEdit}>
          {t(locale, 'staff.duplicateNameEdit')}
        </Button>
        <Button type="button" onClick={onConfirm}>
          {t(locale, 'staff.duplicateNameSaveAnyway')}
        </Button>
      </div>
    </section>
  );
}
