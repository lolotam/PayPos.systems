'use client';

import { t, type MessageKey } from '@pospay/i18n';
import { Button, Card, CardContent, CardFooter, CardHeader, CardTitle } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';
import type { NavigationStyle } from '@/workspace/nav-types';

import { StyleDiagram } from './style-diagram';

const TEXT: Readonly<Record<NavigationStyle, { name: MessageKey; description: MessageKey }>> = {
  A: { name: 'adminNav.styleALabel', description: 'adminNav.styleADescription' },
  B: { name: 'adminNav.styleBLabel', description: 'adminNav.styleBDescription' },
  C: { name: 'adminNav.styleCLabel', description: 'adminNav.styleCDescription' },
};

/** بطاقة نمط واحد: الاسم والرسم والوصف، وعلامة نصية «الحالي» أو زر الاختيار. */
export function StyleCard({
  style,
  current,
  onChoose,
}: {
  style: NavigationStyle;
  current: boolean;
  onChoose: (style: NavigationStyle) => void;
}) {
  const locale = useLocale();
  const name = t(locale, TEXT[style].name);
  return (
    <Card aria-current={current ? 'true' : undefined} className="flex flex-col">
      <CardHeader>
        <CardTitle>{name}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <StyleDiagram style={style} />
        <p className="text-sm text-muted-foreground">{t(locale, TEXT[style].description)}</p>
      </CardContent>
      <CardFooter>
        {current ? (
          <span className="text-sm font-semibold">{t(locale, 'adminNav.currentStyleBadge')}</span>
        ) : (
          <Button type="button" variant="outline" onClick={() => onChoose(style)}>
            {t(locale, 'adminNav.chooseStyleAction')}
            <span className="sr-only">{name}</span>
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
