import {
  ArrowCounterClockwiseIcon,
  BellIcon,
  BuildingsIcon,
  CircleNotchIcon,
  ClockIcon,
  DeviceMobileIcon,
  DeviceMobileSlashIcon,
  HouseIcon,
  KeyIcon,
  LayoutIcon,
  MapPinIcon,
  MonitorIcon,
  MoonIcon,
  ShieldCheckIcon,
  SignOutIcon,
  StarIcon,
  StorefrontIcon,
  SunIcon,
  TranslateIcon,
  TrayIcon,
  UploadSimpleIcon,
  UserIcon,
  WarningCircleIcon,
  WifiSlashIcon,
} from '@phosphor-icons/react/dist/ssr';
import { forwardRef, type ComponentProps, type ForwardRefExoticComponent } from 'react';

import { cn } from './shared/cn.js';

type IconProps = ComponentProps<typeof SunIcon>;
type IconComponent = ForwardRefExoticComponent<IconProps>;

const DEFAULT_ICON_SIZE = 24;
const SIZE_CLASS = /(^|\s)size-/;

type IconOptions = {
  /** أيقونة اتجاهية أفقية: بتتعكس في RTL عشان تمشي مع اتجاه القراءة. */
  mirrorInRtl?: boolean;
};

/**
 * بيغلّف أيقونة Phosphor عشان تاخد مقاس 24px افتراضي (زي lucide) بدل "1em".
 * المقاس الصريح بيكسب دايمًا: prop `size` أو class بيبدأ بـ `size-`.
 *
 * @param Base    أيقونة Phosphor من مدخل `/dist/ssr`
 * @param options `mirrorInRtl` للأيقونات الأفقية الاتجاهية
 * @returns مكوّن أيقونة بنفس الـ API بس بمقاس افتراضي ثابت
 */
function withDefaults(Base: IconComponent, options: IconOptions = {}): IconComponent {
  const Wrapped = forwardRef<SVGSVGElement, IconProps>(function PospayIcon(
    { size, className, ...rest },
    ref,
  ) {
    const hasSizeClass = SIZE_CLASS.test(className ?? '');
    const sizeProps: Pick<IconProps, 'size'> =
      size !== undefined ? { size } : hasSizeClass ? {} : { size: DEFAULT_ICON_SIZE };
    return (
      <Base
        ref={ref}
        {...sizeProps}
        className={cn(options.mirrorInRtl && 'rtl:-scale-x-100', className)}
        {...rest}
      />
    );
  });
  Wrapped.displayName = Base.displayName ?? 'PospayIcon';
  return Wrapped;
}

export const Bell = withDefaults(BellIcon);
export const ArrowCounterClockwise = withDefaults(ArrowCounterClockwiseIcon);
export const Building2 = withDefaults(BuildingsIcon);
export const Store = withDefaults(StorefrontIcon);
export const MapPin = withDefaults(MapPinIcon);
export const House = withDefaults(HouseIcon);
export const ShieldCheck = withDefaults(ShieldCheckIcon);
export const UserRound = withDefaults(UserIcon);
export const WifiOff = withDefaults(WifiSlashIcon);
export const CircleAlert = withDefaults(WarningCircleIcon);
export const Clock3 = withDefaults(ClockIcon);
export const DeviceMobileSlash = withDefaults(DeviceMobileSlashIcon);
export const LoaderCircle = withDefaults(CircleNotchIcon);
export const Inbox = withDefaults(TrayIcon);
export const LogOut = withDefaults(SignOutIcon, { mirrorInRtl: true });
export const KeyRound = withDefaults(KeyIcon);
export const Languages = withDefaults(TranslateIcon);
export const Upload = withDefaults(UploadSimpleIcon);
export const Smartphone = withDefaults(DeviceMobileIcon);
export const Sun = withDefaults(SunIcon);
export const Moon = withDefaults(MoonIcon);
export const Monitor = withDefaults(MonitorIcon);
export const Star = withDefaults(StarIcon);
/** أيقونة «نمط التنقّل» في الشريط العلوي: لوح بمقاطع، زي اختيار شكل الشاشة. */
export const LayoutPanelLeft = withDefaults(LayoutIcon);
