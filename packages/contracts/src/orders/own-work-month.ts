import { z } from 'zod';

export const ownWorkMonth = z.string().regex(/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/);
