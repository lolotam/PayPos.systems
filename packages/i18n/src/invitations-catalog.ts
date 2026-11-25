/** كتالوج دعوة العضو (spec 076 G1): مالك الشركة بس، والرابط مرة واحدة، والتأكيد إجباري (D10). */
export const invitationsEn = {
  title: 'Invite a member',
  lead: 'Invite a manager or an accountant to the back office. The link is shown once; you send it yourself.',
  emailLabel: 'Email',
  nameLabel: 'Name',
  nameRequired: 'Enter the member name.',
  roleLabel: 'Role',
  scopeLabel: 'Scope',
  scopeCompany: 'The whole company',
  scopeBusiness: 'Business',
  scopeBranch: 'Branch',
  roleGeneralManager: 'General manager',
  roleBusinessManager: 'Business manager',
  roleBranchManager: 'Branch manager',
  roleAccountant: 'Accountant',
  confirmLead: 'Check the email before sending:',
  confirmTick: 'I confirmed this email is correct',
  submit: 'Send the invitation',
  linkOnceTitle: 'Set-password link — shown once',
  linkOnceLead:
    'Copy it and send it to the person; it is never shown again, and an older link dies when a newer one is issued.',
  copy: 'Copy the link',
  copied: 'Copied',
  dismiss: 'Hide the link',
  listTitle: 'Invitations',
  statePending: 'Pending',
  stateActive: 'Active',
  stateCancelled: 'Cancelled',
  reissue: 'Issue a new link',
  reissued: 'A new link was issued; the older one is dead.',
  empty: 'No invitations yet.',
  invitedAt: 'Invited at',
  loadMore: 'Load more',
  notReady: 'The invitation routes are closed on the API right now (activation gate). Try after it is turned on.',
};

export const invitationsAr = {
  title: 'دعوة عضو',
  lead: 'بتدعو مديراً أو محاسباً للوحة الإدارة. الرابط بيظهر مرة واحدة وتبعته بنفسك للشخص.',
  emailLabel: 'البريد الإلكتروني',
  nameLabel: 'الاسم',
  nameRequired: 'اكتب اسم العضو.',
  roleLabel: 'الدور',
  scopeLabel: 'النطاق',
  scopeCompany: 'الشركة كلها',
  scopeBusiness: 'نشاط',
  scopeBranch: 'فرع',
  roleGeneralManager: 'مدير عام',
  roleBusinessManager: 'مدير نشاط',
  roleBranchManager: 'مدير فرع',
  roleAccountant: 'محاسب',
  confirmLead: 'راجع البريد قبل الإرسال:',
  confirmTick: 'اتأكدت إن البريد ده صحيح',
  submit: 'إرسال الدعوة',
  linkOnceTitle: 'رابط تعيين كلمة المرور — بيظهر مرة واحدة',
  linkOnceLead: 'انسخه وابعته للشخص؛ مش هيتعرض تاني، والرابط القديم بيبطل لو اتطلع غيره.',
  copy: 'نسخ الرابط',
  copied: 'تم النسخ',
  dismiss: 'اخفي الرابط',
  listTitle: 'الدعوات',
  statePending: 'معلّقة',
  stateActive: 'نشِطة',
  stateCancelled: 'ملغاة',
  reissue: 'إصدار رابط جديد',
  reissued: 'اتصدر رابط جديد؛ الرابط القديم بقى باطل.',
  empty: 'مفيش دعوات بعد.',
  invitedAt: 'تاريخ الدعوة',
  loadMore: 'تحميل المزيد',
  notReady: 'مسارات الدعوة مقفولة على الـ API الآن (بوابة التفعيل). جرّب بعد التفعيل.',
};

export const invitationErrorsEn = {
  MEMBER_INVITATION_EXISTS: 'This email already has an invitation in this company',
  MEMBER_ROLE_NOT_INVITABLE:
    'This role cannot be invited, or its scope does not match the role or belongs to another company',
  MEMBER_EMAIL_NOT_INVITABLE: 'This email cannot be invited',
  MEMBER_INVITATION_NOT_REISSUEABLE:
    'A new link cannot be issued for this invitation; the member already set a password',
  LAST_OWNER:
    'The last owner of a company cannot be ended; the company must keep at least one owner',
  STAFF_ACCESS_MANAGED_MEMBERSHIP:
    'An employee staff-access membership is stopped from the employee page via Stop access, not from the permissions screen',
} as const;

export const invitationErrorsAr = {
  MEMBER_INVITATION_EXISTS: 'الإيميل ده عنده دعوة في الشركة بالفعل',
  MEMBER_ROLE_NOT_INVITABLE:
    'الدور ده ما بيتدعىش، أو نطاقه ما بيتوافقش مع الدور أو بيتبع شركة تانية',
  MEMBER_EMAIL_NOT_INVITABLE: 'الإيميل ده ما بيتدعىش',
  MEMBER_INVITATION_NOT_REISSUEABLE:
    'مينفعش نطلع رابط جديد للدعوة دي؛ العضو حط كلمة مروره بالفعل',
  LAST_OWNER: 'مينفعش تنهي آخر مالك في الشركة؛ لازم يفضل للشركة مالك واحد على الأقل',
  STAFF_ACCESS_MANAGED_MEMBERSHIP:
    'عضوية دخول الموظفة بتتوقف من صفحة الموظفة عبر «إيقاف الدخول»، مش من شاشة الصلاحيات',
} as const;
