import { cookies } from 'next/headers';

import { LOCALE_COOKIE } from './locale-cookie';
import { parseLocale } from './parse-locale';

export async function readRequestLocale() {
  const jar = await cookies();
  return parseLocale(jar.get(LOCALE_COOKIE)?.value);
}
