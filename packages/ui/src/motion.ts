import type { Variants } from 'motion/react';

export const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
} satisfies Variants;

export const slideIn = {
  rtl: {
    hidden: { opacity: 0, x: 16 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.2 } },
    exit: { opacity: 0, x: 16, transition: { duration: 0.15 } },
  },
  ltr: {
    hidden: { opacity: 0, x: -16 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.2 } },
    exit: { opacity: 0, x: -16, transition: { duration: 0.15 } },
  },
} satisfies Record<'rtl' | 'ltr', Variants>;

export const reducedMotion = {
  hidden: { opacity: 1, x: 0 },
  visible: { opacity: 1, x: 0, transition: { duration: 0 } },
  exit: { opacity: 1, x: 0, transition: { duration: 0 } },
} satisfies Variants;
