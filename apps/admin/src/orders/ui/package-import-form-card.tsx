'use client';
import { t } from '@pospay/i18n';
import { Button, Card, CardContent, CardFooter, Input } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

type PackageImportFormCardProps = {
  templateReady: boolean;
  onDownload: () => void;
  onSelect: (file: File | undefined) => void;
  canPreview: boolean;
  onInspect: () => void;
  canCommit: boolean;
  onCommit: () => void;
};

/** كرت استيراد الباقات: قسم القالب وقسم الملف، وشريط الإجراءات في ذيله والحفظ آخره. */
export function PackageImportFormCard({
  templateReady,
  onDownload,
  onSelect,
  canPreview,
  onInspect,
  canCommit,
  onCommit,
}: PackageImportFormCardProps) {
  const locale = useLocale();
  return (
    <Card>
      <CardContent className="grid gap-6">
        <p className="text-sm text-muted-foreground">{t(locale, 'packageImport.lead')}</p>
        <section className="grid gap-4">
          <h2 className="text-lg font-semibold">{t(locale, 'packageImport.sectionTemplate')}</h2>
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 min-w-0">
              <Button
                type="button"
                variant="outline"
                disabled={!templateReady}
                onClick={onDownload}
              >
                {t(locale, 'packageImport.download')}
              </Button>
            </div>
          </div>
        </section>
        <section className="grid gap-4">
          <h2 className="text-lg font-semibold">{t(locale, 'packageImport.sectionFile')}</h2>
          <div className="grid grid-cols-12 gap-4">
            <label className="col-span-12 flex min-w-0 flex-col gap-2 text-sm">
              {t(locale, 'packageImport.choose')}
              <Input
                type="file"
                accept=".xlsx"
                onChange={(event) => onSelect(event.target.files?.[0])}
              />
            </label>
          </div>
        </section>
      </CardContent>
      <CardFooter className="justify-end">
        <Button type="button" variant="outline" disabled={!canPreview} onClick={onInspect}>
          {t(locale, 'packageImport.preview')}
        </Button>
        <Button type="button" variant="outline" disabled={!canCommit} onClick={onCommit}>
          {t(locale, 'packageImport.commit')}
        </Button>
      </CardFooter>
    </Card>
  );
}
