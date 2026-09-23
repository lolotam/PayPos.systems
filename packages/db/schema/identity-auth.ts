import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// هوية عامة (ADR-0003 §2.1): جداول Better Auth — مفيش company_id ولا tenant RLS، والوصول ليها من packages/auth بس
// على role اسمه pospay_auth. الـ property names (emailVerified…) هي أسماء الـ fields في Better Auth 1.7 بالظبط،
// والأعمدة snake_case زي باقي الـ schema. الـ ids بتتولّد UUID v7 من packages/auth.

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const user = pgTable(
  'user',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    // two-factor plugin
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    // phone-number plugin (ADR-0003 §2.1) — the columns exist from T9b; the plugin is registered only with a delivery
    // channel (P1-T7), so nothing can set them yet. E.164, stored whole: this is the auth database, never a log.
    phoneNumber: text('phone_number'),
    phoneNumberVerified: boolean('phone_number_verified'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('user_email_key').on(t.email),
    uniqueIndex('user_phone_number_key').on(t.phoneNumber),
    check('user_phone_number_e164', sql`${t.phoneNumber} IS NULL OR ${t.phoneNumber} ~ '^[+][1-9][0-9]{6,14}$'`),
    check('user_email_length', sql`char_length(${t.email}) BETWEEN 3 AND 320`),
    check('user_name_length', sql`char_length(${t.name}) BETWEEN 1 AND 255`),
  ],
);

export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // الـ token نفسه في الـ cookie (موقّع)؛ ده مفتاح البحث.
    token: text('token').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // hint بس (ADR-0003 §4): بيتراجع على الـ memberships في كل request، ومبيدّيش أي صلاحية لوحده.
    activeCompanyId: uuid('active_company_id'),
    ...timestamps,
  },
  (t) => [uniqueIndex('session_token_key').on(t.token), index('session_user_id_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: uuid('id').primaryKey(),
    // للـ credential provider ده هو id المستخدم؛ لـ OAuth هو id المستخدم عند الـ provider.
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    // hash الباسورد — مفيش module بيقراه غير Better Auth (CLAUDE.md §8).
    password: text('password'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('account_provider_account_key').on(t.providerId, t.accountId),
    index('account_user_id_idx').on(t.userId),
  ],
);

export const verification = pgTable(
  'verification',
  {
    id: uuid('id').primaryKey(),
    // الإيميل أو المفتاح اللي الـ token متربوط بيه (تفعيل الإيميل، reset الباسورد).
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

export const twoFactor = pgTable(
  'two_factor',
  {
    id: uuid('id').primaryKey(),
    // سر الـ TOTP والـ backup codes — Better Auth بيشفّرهم بالـ BETTER_AUTH_SECRET قبل ما يتكتبوا.
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (t) => [uniqueIndex('two_factor_user_id_key').on(t.userId)],
);
