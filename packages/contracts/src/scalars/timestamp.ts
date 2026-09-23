import { z } from 'zod';

export const timestamp = z.iso.datetime({ offset: true });
