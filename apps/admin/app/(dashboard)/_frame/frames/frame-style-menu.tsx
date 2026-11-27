'use client';

import { t, type MessageKey } from '@pospay/i18n';
import { AccountMenu, LayoutPanelLeft } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';
import type { NavigationStyle } from '@/workspace/nav-types';

import { NAVIGATION_STYLES } from '../navigation-model';
import { useNavStyle } from '../nav-style/nav-style-context';

const STYLE_LABELS: Readonly<Record<NavigationStyle, MessageKey>> = {
  A: 'adminNav.styleALabel',
  B: 'adminNav.styleBLabel',
  C: 'adminNav.styleCLabel',
};

/**
 * قائمة اختيار نمط التنقّل في الشريط العلوي: بتختار النمط من الهيدر مباشرةً بدل قائمة الحساب.
 * النمط الحالي معلّم بعلامة صح في نص المدخل، وكل النصوص مترجمة من الفهرس.
 */
export function FrameStyleMenu({ resetKey }: { resetKey?: string }) {
  const locale = useLocale();
  const { style, setStyle } = useNavStyle();
  const entries = NAVIGATION_STYLES.map((option) => {
    const labelText = t(locale, STYLE_LABELS[option]);
    return {
      id: `style-${option}`,
      label: option === style ? `✓ ${labelText}` : labelText,
      onSelect: () => setStyle(option),
    };
  });
  return (
    <AccountMenu
      labels={{ label: t(locale, 'adminNav.accountMenuStyle') }}
      icon={<LayoutPanelLeft aria-hidden="true" className="size-5" />}
      entries={entries}
      resetKey={resetKey}
      className="shrink-0"
    />
  );
}
