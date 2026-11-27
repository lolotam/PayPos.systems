'use client';

import { t, type MessageKey } from '@pospay/i18n';
import { AccountMenu, LayoutPanelLeft } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';
import type { NavigationStyle } from '@/workspace/nav-types';

const STYLES: readonly NavigationStyle[] = ['A', 'B', 'C'];

const STYLE_LABELS: Readonly<Record<NavigationStyle, MessageKey>> = {
  A: 'adminNav.styleALabel',
  B: 'adminNav.styleBLabel',
  C: 'adminNav.styleCLabel',
};

/**
 * قائمة اختيار نمط التنقّل في الشريط العلوي: نمط لكل مدخل، والنمط الحالي عليه
 * علامة صح مرئية، واسم مدخله يقرأه قارئ الشاشة بكلمة «الحالي» لأن علامة الصح
 * نفسها ما تنطقها القارئات. النمط الحالي ودالة الاختيار يصلان من المستضيف.
 */
export function HeaderStyleMenu({
  style,
  onChoose,
  resetKey,
}: {
  style: NavigationStyle;
  onChoose: (style: NavigationStyle) => void;
  resetKey?: string | undefined;
}) {
  const locale = useLocale();
  const entries = STYLES.map((option) => {
    const labelText = t(locale, STYLE_LABELS[option]);
    const current = option === style;
    return {
      id: `style-${option}`,
      label: current ? `✓ ${labelText}` : labelText,
      ariaLabel: current ? `${labelText} — ${t(locale, 'adminNav.currentStyleBadge')}` : labelText,
      current,
      onSelect: () => onChoose(option),
    };
  });
  return (
    <AccountMenu
      labels={{ label: t(locale, 'adminNav.accountMenuStyle') }}
      icon={<LayoutPanelLeft aria-hidden="true" className="size-4" />}
      entries={entries}
      resetKey={resetKey}
      className="shrink-0"
    />
  );
}
