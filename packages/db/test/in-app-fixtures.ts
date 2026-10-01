import type postgres from 'postgres';

import { USER } from './tenancy-fixtures.ts';

export const OTHER_INBOX_USER = '01920000-0000-7000-8000-0000000000f2';
export const INBOX_ID = '01920000-0000-7000-8000-0000000000c1';
export const SAFE_PARAMETERS = [{ name: 'subject', type: 'text', value: 'Synthetic subject' }];

export async function seedInboxUsers(owner: postgres.Sql): Promise<void> {
  await owner`INSERT INTO "user" (id,name,email) VALUES
    (${USER},'Synthetic user','inbox-a@example.test'),
    (${OTHER_INBOX_USER},'Synthetic other','inbox-b@example.test') ON CONFLICT DO NOTHING`;
}
