import { z } from 'zod';
import { id as sharedId } from '../scalars/id.js';
import { timestamp } from '../scalars/timestamp.js';
import { sessionMoney } from './service-session.js';

const id = sharedId.toLowerCase();

// 20 بنداً × 4 منفّذات × طريقتا دفع.
const SESSION_TIP_ENTRY_LIMIT = 160;

export const sessionTipEntry = z
  .strictObject({
    employee_id: id,
    method: z.enum(['CASH', 'CARD']),
    amount: sessionMoney,
  })
  .meta({ id: 'SessionTipEntry' });

export const recordSessionTipsInput = z
  .strictObject({
    expected_revision: z.number().int().min(0),
    tips: z.array(sessionTipEntry).max(SESSION_TIP_ENTRY_LIMIT),
    // بلا حد طول حتى يصل السبب المعطوب إلى النطاق ويرد 422، كما في FR-003 لتعديل السطر.
    reason: z.string().optional(),
    recorder_membership_id: id.optional(),
  })
  .meta({ id: 'RecordSessionTipsInput' });

export const sessionTips = z
  .strictObject({
    revision: z.number().int().min(0),
    tips: z.array(sessionTipEntry).max(SESSION_TIP_ENTRY_LIMIT),
    total_cash: sessionMoney,
    total_card: sessionMoney,
  })
  .meta({ id: 'SessionTips' });

export const sessionTipsChanged = z
  .strictObject({
    session_id: id,
    business_id: id,
    branch_id: id,
    occurred_at: timestamp,
    business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    revision: z.number().int().positive(),
    changed_at: timestamp,
    tips: z.array(sessionTipEntry).max(SESSION_TIP_ENTRY_LIMIT),
    schema_version: z.literal(1),
  })
  .meta({ id: 'SessionTipsChanged' });

export const sessionTipsSchemas = [
  sessionTipEntry,
  recordSessionTipsInput,
  sessionTips,
  sessionTipsChanged,
];

export type SessionTipEntry = z.infer<typeof sessionTipEntry>;
export type RecordSessionTipsInput = z.infer<typeof recordSessionTipsInput>;
export type SessionTips = z.infer<typeof sessionTips>;
export type SessionTipsChanged = z.infer<typeof sessionTipsChanged>;
