import type {
  CommissionPlanCalc,
  CommissionPlanComponent,
  CommissionPlanTiers,
  CommissionPlanVersion,
} from '@pospay/contracts';
import { formatDate, t, type Locale } from '@pospay/i18n';
import type { ColumnDef } from '@tanstack/react-table';

function calcSummary(calc: CommissionPlanCalc, locale: Locale): string {
  return calc.kind === 'PCT'
    ? `${t(locale, 'commissionPlanBuilder.calcPct')} ${calc.bps}`
    : `${t(locale, 'commissionPlanBuilder.calcFixed')} ${calc.amount}`;
}

/** ملخّص بلوك مفعّل سطر واحد، والمعطّل اللي حافظ إعداده بيظهرها معطّل زي ما العقد محتفظ بيها (CM-06). */
function componentSummary(block: CommissionPlanComponent, locale: Locale): string {
  if (block.enabled) return calcSummary(block.calc, locale);
  if (block.calc === undefined) return t(locale, 'commissionPlanBuilder.blockOff');
  return `${t(locale, 'commissionPlanBuilder.blockOff')} (${calcSummary(block.calc, locale)})`;
}

function modeName(mode: 'MARGINAL' | 'WHOLE', locale: Locale): string {
  return t(
    locale,
    mode === 'MARGINAL' ? 'commissionPlanBuilder.modeMarginal' : 'commissionPlanBuilder.modeWhole',
  );
}

function accumulatorName(accumulator: 'AMOUNT' | 'SESSIONS', locale: Locale): string {
  return t(
    locale,
    accumulator === 'AMOUNT'
      ? 'commissionPlanBuilder.accumulatorAmount'
      : 'commissionPlanBuilder.accumulatorSessions',
  );
}

function tiersSettings(block: CommissionPlanTiers, locale: Locale): string[] {
  const parts: string[] = [];
  if (block.mode !== undefined) parts.push(modeName(block.mode, locale));
  if (block.accumulator !== undefined) parts.push(accumulatorName(block.accumulator, locale));
  if (block.steps !== undefined)
    parts.push(`${t(locale, 'commissionPlanBuilder.summarySteps')}: ${block.steps.length}`);
  return parts;
}

function tiersSummary(block: CommissionPlanTiers, locale: Locale): string {
  if (block.enabled) {
    const parts = [
      modeName(block.mode, locale),
      accumulatorName(block.accumulator, locale),
      `${t(locale, 'commissionPlanBuilder.summarySteps')}: ${block.steps.length}`,
    ];
    return parts.join(' · ');
  }
  const parts = tiersSettings(block, locale);
  return parts.length === 0
    ? t(locale, 'commissionPlanBuilder.blockOff')
    : `${t(locale, 'commissionPlanBuilder.blockOff')} (${parts.join(' · ')})`;
}

export function civilDate(value: string, locale: Locale): string {
  return formatDate(new Date(`${value}T12:00:00Z`), {
    locale,
    calendar: 'gregorian',
    timeZone: 'UTC',
  });
}

/** لحظة الإنشاء بتتعرض في توقيت النشاط من الـ scope مش بتوقيت UTC، وeffective_from تاريخ مدني فبيفضل زي ما هو. */
export function stampDate(value: string, locale: Locale, timeZone: string): string {
  return formatDate(new Date(value), { locale, calendar: 'gregorian', timeZone });
}

/** أعمدة تاريخ النسخ: الرقم والتاريخ وكامل الفترة وملخّص البلوكات الثلاثة ووقت الإنشاء. */
export function planHistoryColumns(
  locale: Locale,
  timeZone: string,
): ColumnDef<CommissionPlanVersion>[] {
  return [
    {
      id: 'version',
      header: t(locale, 'commissionPlanBuilder.colVersion'),
      cell: ({ row }) =>
        row.original.repair_period === null
          ? row.original.version
          : `${row.original.version} · ${t(locale, 'commissionPlanBuilder.repairOf')} ${row.original.repair_period}`,
    },
    {
      id: 'effectiveFrom',
      header: t(locale, 'commissionPlanBuilder.effectiveFrom'),
      cell: ({ row }) => civilDate(row.original.effective_from, locale),
    },
    {
      id: 'wholePeriod',
      header: t(locale, 'commissionPlanBuilder.wholePeriod'),
      cell: ({ row }) =>
        t(
          locale,
          row.original.whole_period
            ? 'commissionPlanBuilder.wholeYes'
            : 'commissionPlanBuilder.wholeNo',
        ),
    },
    {
      id: 'blocks',
      header: t(locale, 'commissionPlanBuilder.colBlocks'),
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span>{componentSummary(row.original.base, locale)}</span>
          <span>{tiersSummary(row.original.tiers, locale)}</span>
          <span>{componentSummary(row.original.package_sale, locale)}</span>
        </span>
      ),
    },
    {
      id: 'createdAt',
      header: t(locale, 'commissionPlanBuilder.colCreatedAt'),
      cell: ({ row }) => stampDate(row.original.created_at, locale, timeZone),
    },
  ];
}
