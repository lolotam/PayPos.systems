-- قرار المالك في DA-Q4b (أبو سالم، أكّده وليد في 2026-10-22): الـ 24 ساعة بتتحسب من وقت الطلب، فالـ expires_at بتتكتب مرة واحدة عند الطلب وما بتتغيرش بعدها؛ لا الموافقة ولا الرفض بيفتحوا نافذة جديدة.
CREATE OR REPLACE FUNCTION discount_proposals_transition_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'PENDING' THEN
      RAISE EXCEPTION 'a discount proposal is requested PENDING' USING ERRCODE = '23514', CONSTRAINT = 'discount_proposals_transition_guard';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'REJECTED') THEN
    IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      RAISE EXCEPTION 'deciding a discount proposal keeps expires_at' USING ERRCODE = '23514', CONSTRAINT = 'discount_proposals_transition_guard';
    END IF;
    IF (to_jsonb(OLD) - ARRAY['status', 'decided_by', 'decided_by_membership_id', 'decided_via',
        'decided_device_id', 'decider_name_ar', 'decider_name_en', 'decider_role', 'decider_role_is_system',
        'decider_role_name_ar', 'decider_role_name_en', 'decided_at', 'approved_limit_source', 'approved_limit_bps',
        'approver_is_performer', 'reject_reason']) IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['status', 'decided_by',
        'decided_by_membership_id', 'decided_via', 'decided_device_id', 'decider_name_ar', 'decider_name_en',
        'decider_role', 'decider_role_is_system', 'decider_role_name_ar', 'decider_role_name_en', 'decided_at',
        'approved_limit_source', 'approved_limit_bps', 'approver_is_performer', 'reject_reason']) THEN
      RAISE EXCEPTION 'deciding a discount proposal changes only the decision columns' USING ERRCODE = '23514', CONSTRAINT = 'discount_proposals_transition_guard';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'APPROVED' AND NEW.status = 'CONSUMED' THEN
    IF (to_jsonb(OLD) - ARRAY['status', 'consumed_line_id', 'consumed_edit_id', 'consumed_at'])
        IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['status', 'consumed_line_id', 'consumed_edit_id', 'consumed_at']) THEN
      RAISE EXCEPTION 'consuming a discount proposal changes only status, consumed_line_id, consumed_edit_id and consumed_at' USING ERRCODE = '23514', CONSTRAINT = 'discount_proposals_transition_guard';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a discount proposal moves only PENDING to APPROVED or REJECTED, or APPROVED to CONSUMED' USING ERRCODE = '23514', CONSTRAINT = 'discount_proposals_transition_guard';
END $$;
