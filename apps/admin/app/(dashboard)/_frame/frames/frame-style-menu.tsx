'use client';

import { HeaderStyleMenu } from '@/settings/appearance/ui/header-style-menu';

import { useNavStyle } from '../nav-style/nav-style-context';

/**
 * قائمة نمط التنقّل داخل الإطار: النمط الحالي ودالة تغييره من مزوّد النمط، فالتغيير
 * يبدّل الإطار فورًا، والقائمة نفسها في `src/` لأن `app/` لا يحتفظ بواجهة.
 */
export function FrameStyleMenu({ resetKey }: { resetKey?: string }) {
  const { style, setStyle } = useNavStyle();
  return <HeaderStyleMenu style={style} onChoose={setStyle} resetKey={resetKey} />;
}
