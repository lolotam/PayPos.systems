import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * بيانات الاتصال اللي الاختبارات محتاجاها — كلها من الـ .env بتاع الـ repo (أو من CI).
 */
export interface PgTestEnv {
  readonly host: string;
  readonly port: string;
  readonly ownerUser: string;
  readonly ownerPassword: string;
  readonly appPassword: string;
  readonly authPassword: string;
}

const ROOT_ENV = fileURLToPath(new URL('../../../.env', import.meta.url));

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set — copy .env.example to .env and fill it in`);
  }
  return value;
}

/**
 * بيقرا الـ .env ويرجّع بيانات الاتصال بالـ cluster بتاع T2.
 *
 * @returns بيانات الاتصال
 */
export function readPgTestEnv(): PgTestEnv {
  if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);
  return {
    host: process.env['POSTGRES_HOST'] ?? '127.0.0.1',
    port: process.env['POSTGRES_PORT'] ?? '5432',
    ownerUser: process.env['POSTGRES_OWNER_USER'] ?? 'pospay_owner',
    ownerPassword: required('POSTGRES_OWNER_PASSWORD'),
    appPassword: required('POSTGRES_APP_PASSWORD'),
    authPassword: required('POSTGRES_AUTH_PASSWORD'),
  };
}

/**
 * بيبني connection URL — الباسورد بيتعمله encode عشان أي حرف خاص ميكسرش الـ URL.
 *
 * @param env      بيانات الاتصال
 * @param user     الـ role
 * @param password باسورد الـ role
 * @param database اسم الداتابيز
 * @returns الـ URL
 */
export function pgUrl(env: PgTestEnv, user: string, password: string, database: string): string {
  return `postgres://${user}:${encodeURIComponent(password)}@${env.host}:${env.port}/${database}`;
}
