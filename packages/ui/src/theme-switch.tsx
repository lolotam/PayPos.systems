'use client';

import { MonitorIcon, MoonIcon, SunIcon } from '@phosphor-icons/react/dist/ssr';
import { useSyncExternalStore } from 'react';

import { cn } from './shared/cn.js';
import { SIDEBAR_GHOST_CLASSES } from './sidebar-classes.js';
import {
  readThemePreference,
  setThemePreference,
  subscribeToThemePreference,
  type ThemePreference,
} from './theme.js';

export type ThemeSwitchLabels = {
  /** اسم المجموعة لقارئات الشاشة. */
  label: string;
  light: string;
  dark: string;
  system: string;
};

export type ThemeSwitchProps = {
  labels: ThemeSwitchLabels;
  /** 'sidebar' بيخلي الألوان تجيب من الشريط الجانبي بدل ألوان الصفحة. */
  tone?: 'default' | 'sidebar';
  className?: string;
};

const OPTIONS: { value: ThemePreference; icon: typeof SunIcon }[] = [
  { value: 'light', icon: SunIcon },
  { value: 'dark', icon: MoonIcon },
  { value: 'system', icon: MonitorIcon },
];

/** على السيرفر مفيش تخزين، فالنظام هو الافتراضي لحد ما العميل يقرا الاختيار المحفوظ. */
function serverPreference(): ThemePreference {
  return 'system';
}

/**
 * مبدّل وضع العرض: تلات اختيارات (فاتح/غامق/حسب النظام)، الاختيار بيتكتب في localStorage
 * وبيطبّق على الصفحة فورًا، وبينتشر على التبويبات التانية.
 */
export function ThemeSwitch({ labels, tone = 'default', className }: ThemeSwitchProps) {
  const preference = useSyncExternalStore(
    subscribeToThemePreference,
    readThemePreference,
    serverPreference,
  );
  const selected =
    tone === 'sidebar'
      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
      : 'bg-brand text-brand-foreground';
  const idle =
    tone === 'sidebar'
      ? SIDEBAR_GHOST_CLASSES
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground';
  return (
    <div
      role="group"
      aria-label={labels.label}
      className={cn(
        'inline-flex w-fit items-center gap-1 rounded-interactive border p-1',
        tone === 'sidebar' ? 'border-sidebar-border' : 'border-border',
        className,
      )}
    >
      {OPTIONS.map(({ value, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={preference === value}
          aria-label={labels[value]}
          title={labels[value]}
          onClick={() => setThemePreference(value)}
          className={cn(
            'inline-flex size-11 items-center justify-center rounded-sm transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            preference === value ? selected : idle,
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
        </button>
      ))}
    </div>
  );
}
