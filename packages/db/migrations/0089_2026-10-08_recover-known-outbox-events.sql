-- هذه الأنواع أصبحت معروفة وبلا مستهلك؛ عند الحجز التالي تُعلَّم كمنشورة دون أي تأثير، لذا إعادة صفوفها آمنة.
UPDATE outbox
SET parked_at = NULL,
    attempts = 0,
    next_attempt_at = clock_timestamp(),
    last_error = NULL
WHERE published_at IS NULL
  AND parked_at IS NOT NULL
  AND event_type IN (
    'SalaryChanged',
    'LeaveRequested',
    'LeaveCancelled',
    'LeaveApproved',
    'LeaveRejected',
    'LeaveRevoked',
    'EmployeePasskeyBound'
  );
