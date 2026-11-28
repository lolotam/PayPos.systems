-- PP-286 T-9 (#984): append trailing pg_temp to every public function search_path that omits it.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER FUNCTION public.app_company_id SET search_path = pg_catalog, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.app_user_id SET search_path = pg_catalog, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.commission_coverage_required_version SET search_path = pg_catalog, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.employee_branches_close_once SET search_path = pg_catalog, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.enforce_passkey_installation_set_once SET search_path = pg_catalog, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.enforce_staff_otp_attempt SET search_path = pg_catalog, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.enforce_staff_otp_challenge SET search_path = pg_catalog, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.enforce_staff_session SET search_path = pg_catalog, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.invalidate_staff_phone_binding SET search_path = pg_catalog, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.pospay_system_id SET search_path = pg_catalog, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.staff_columns_distinct SET search_path = pg_catalog, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.commission_blocked_corrections_update_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.commission_statement_exports_insert_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.commission_statement_exports_update_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.commission_statement_frozen_insert_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.commission_statement_payments_insert_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.commission_statements_insert_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.commission_statements_payment_complete SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.commission_statements_update_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.customers_opt_out_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.customers_profile_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.discount_proposals_transition_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.initialize_attendance_state SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.leave_history_report_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.leave_history_report_row_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.line_performers_cancel_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.line_performers_change_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.orders_check_performers SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.orders_performer_consistency SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_components_insert_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_components_update_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_entitlement_value_conservation SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_entitlements_extension_complete SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_entitlements_insert_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_entitlements_update_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_extensions_history_complete SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_import_preview_partition_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_import_preview_update_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_redemption_complete SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_redemption_validate SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_redemption_validate_slot SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_redemptions_write_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_refund_complete SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_refund_slot_state_complete SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_refund_slots_sessions_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_refund_validate SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_refund_validate_entitlement SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_refund_validate_slots SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_sale_request_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_session_slots_insert_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.package_session_slots_update_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.rating_attributions_insert_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.rating_performers_insert_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.rating_requests_consumed_has_rating SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.rating_requests_insert_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.rating_requests_update_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.ratings_attributions_complete SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.ratings_insert_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.service_category_closing_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.service_lines_cancel_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.service_lines_performer_transition SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.service_lines_redemption_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.service_session_recoveries_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.session_tip_revisions_begin SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.session_tips_insert_guard SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.slc_complete SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.slc_validate_line SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.slpc_begin SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.slpc_change_complete SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.slpc_same_tuple SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.slpc_side_shape_ok SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.slpc_tuple_matches SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.slpc_validate_change SET search_path = pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.slpcr_insert_guard SET search_path = pg_catalog, public, pg_temp;
