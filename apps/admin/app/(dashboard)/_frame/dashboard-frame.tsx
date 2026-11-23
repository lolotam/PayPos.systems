'use client';

import type { ReactElement, ReactNode } from 'react';

import type { NavigationStyle } from '@/workspace/nav-types';

import { DashboardContent } from './dashboard-content';
import { StyleAFrame } from './frames/style-a-frame';
import { StyleBFrame } from './frames/style-b-frame';
import { StyleCFrame } from './frames/style-c-frame';
import { useNavStyle } from './nav-style/nav-style-context';

const FRAMES: Readonly<Record<NavigationStyle, (props: { children: ReactNode }) => ReactElement>> =
  { A: StyleAFrame, B: StyleBFrame, C: StyleCFrame };

/** يرسم الصفحة داخل إطار النمط الحالي؛ تغيير النمط يبدّل الإطار فقط دون إعادة تحميل ولا تغيير العنوان. */
export function DashboardFrame({ children }: { children: ReactNode }) {
  const { style } = useNavStyle();
  const Frame = FRAMES[style];
  return (
    <Frame>
      <DashboardContent>{children}</DashboardContent>
    </Frame>
  );
}
