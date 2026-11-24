'use client';

import { AppearancePage } from '@/settings/appearance/ui/appearance-page';

import { useNavStyle } from './nav-style/nav-style-context';

/** صفحة المظهر داخل الإطار: النمط الحالي ودالة تغييره من مزوّد النمط، فالتغيير يبدّل الإطار فورًا. */
export function AppearanceRoute() {
  const { style, setStyle } = useNavStyle();
  return <AppearancePage style={style} onChoose={setStyle} />;
}
