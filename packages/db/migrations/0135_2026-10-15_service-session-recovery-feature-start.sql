-- Apply time of the recovery proof feature. The journal timestamp is the folder clock, not this moment.
-- Do not COMMENT ON this table without keeping the recovery_feature_started_at marker.
DO $$
BEGIN
  EXECUTE format(
    'COMMENT ON TABLE service_session_recoveries IS %L',
    'recovery_feature_started_at=' || to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  );
END $$;
