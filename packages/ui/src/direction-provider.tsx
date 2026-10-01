'use client';

import { Direction } from 'radix-ui';
import type { ComponentProps } from 'react';

export type DirectionProviderProps = Omit<ComponentProps<'div'>, 'dir'> & {
  dir?: 'rtl' | 'ltr';
};

export function DirectionProvider({ dir = 'rtl', children, ...props }: DirectionProviderProps) {
  return (
    <Direction.Provider dir={dir}>
      <div {...props} dir={dir}>
        {children}
      </div>
    </Direction.Provider>
  );
}

export const useDirection = Direction.useDirection;
