import {
  ArrowCounterClockwise,
  Bell,
  Building2,
  CircleAlert,
  Clock3,
  House,
  Inbox,
  KeyRound,
  MapPin,
  Monitor,
  ShieldCheck,
  Smartphone,
  Star,
  Store,
  Upload,
  UserRound,
} from '@pospay/ui';
import type { ComponentType, ReactNode } from 'react';

import type { NavigationIconName } from '@/workspace/nav-types';

const ICONS: Readonly<Record<NavigationIconName, ComponentType<{ className?: string }>>> = {
  ArrowCounterClockwise,
  Bell,
  Building2,
  CircleAlert,
  Clock3,
  House,
  Inbox,
  KeyRound,
  MapPin,
  Monitor,
  ShieldCheck,
  Smartphone,
  Star,
  Store,
  Upload,
  UserRound,
};

/** أيقونة المدخل من اسمها في نموذج التنقّل؛ زخرفية فقط لأن النص بجانبها يسمّي المدخل. */
export function navigationIcon(name: NavigationIconName): ReactNode {
  const Icon = ICONS[name];
  return <Icon className="size-5" />;
}
