import { z } from 'zod';

import { responseObject } from '../response-object.js';

export const navStyle = z.enum(['A', 'B', 'C']).meta({ id: 'NavStyle' });
export const myPreferencesResponse = responseObject({ navStyle: navStyle.nullable() }).meta({
  id: 'MyPreferencesResponse',
});
export const setMyPreferencesInput = z.strictObject({ navStyle: navStyle.nullable() }).meta({
  id: 'SetMyPreferencesInput',
});
export type NavStyle = z.infer<typeof navStyle>;
export type MyPreferencesResponse = z.infer<typeof myPreferencesResponse>;
export type SetMyPreferencesInput = z.infer<typeof setMyPreferencesInput>;
