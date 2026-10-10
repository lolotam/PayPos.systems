// رسائل الحضور الشخصي منفصلة للحفاظ على حجم الكتالوج.
export const attendanceEn = {
  title: 'Clock attendance',
  scan: 'Scan the branch QR',
  cameraLead: 'Point your camera at the branch attendance QR.',
  cameraLabel: 'Attendance QR camera',
  cancel: 'Cancel scan',
  pending: 'Unlock your passkey to record attendance…',
  failed:
    'Attendance could not be recorded. Check your connection, scan a fresh QR and unlock your passkey, or use your attendance card at reception or ask your manager.',
  clockedIn: 'Clocked in',
  clockedOut: 'Clocked out',
  noLocation: 'Recorded with a location exception: no usable location or branch coordinates.',
  outOfRange: 'Recorded with a location exception: outside the branch range.',
  missedOut: 'The previous session was closed as a missed clock-out.',
  late: 'Reported late minutes (no commission deduction)',
  storageBlocked:
    'Storage is blocked in this browser, so this phone cannot be recognised. Allow site data or open the app from the home screen, or use the card at reception.',
} as const;
