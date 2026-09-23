import { z } from 'zod';

// الإنجليزي إجباري والعربي اختياري (CLAUDE.md §5)؛ الحد 255 قرار Waleed (2026-09-23).
export const nameEn = z.string().trim().min(1).max(255);
export const nameAr = z.string().trim().min(1).max(255);
