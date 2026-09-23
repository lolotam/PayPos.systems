import { z } from 'zod';

// UUID v7 بيتعمل على الـ client وقت الـ offline، فأي UUID صالح بيتقبل — مش v4 بس.
export const id = z.uuid();
