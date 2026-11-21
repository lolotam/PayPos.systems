/* Page inventory, shared by the three prototypes. Every string is 'English|Arabic'.
   Sample rows are examples, not real tenant data. Arabic copy here is indicative: the product
   strings stay in packages/i18n. */
const B = (b, t) => ({ b, t });
const A = (a, go, v) => ({ a, go, v });
const N = (n) => ({ n });
const BRANCHES = ['Salmiya|السالمية', 'Hawally|حولي', 'Jahra|الجهراء'];
const ALLBR = ['All branches|كل الفروع', ...BRANCHES];
const EMP = ['Noor Al-Mutairi|نور المطيري', 'Sara Al-Enezi|سارة العنزي', 'Maryam Hussain|مريم حسين', 'Dalal Al-Rashidi|دلال الرشيدي', 'Fatma Ali|فاطمة علي', 'Hessa Al-Ajmi|حصة العجمي'];
const SVC = ['Haircut|قص شعر', 'Hair colour|صبغة شعر', 'Manicure|مانيكير', 'Pedicure|باديكير', 'Facial|تنظيف بشرة', 'Blow-dry|سشوار'];
const LEAVE_T = ['Annual|سنوية', 'Sick|مرضية', 'Unpaid|بدون راتب', 'Other|أخرى'];
const PAGER = 'pager', MORE = 'more';
const CUSTOMER = { title: 'Customer|العميل', fields: [
  ['Customer name|اسم العميل', 'text', 'Latifa Al-Sabah|لطيفة الصباح'],
  ['Calling code|مفتاح الدولة', 'select', ['+965', '+966', '+971'], 4],
  ['Phone number (without calling code)|رقم الهاتف (بدون المفتاح)', 'text', '5550 1234', 4],
  ['', 'button', 'Find or create customer|بحث أو إضافة عميل', 4]] };
const LEAVE_COLS = ['Date|التاريخ', 'Leave type|نوع الإجازة', 'Status|الحالة', 'Employee|الموظف', 'Decision reason|سبب القرار', 'Decision|القرار'];

const PAGES = {
  home: { title: 'Workspace|مساحة العمل', desc: 'Your company, business and branch at a glance.|شركتك ونشاطك وفرعك في نظرة واحدة.', blocks: [
    ['stats', [['Company|الشركة', 'Lulwa Group|مجموعة لولوة', '', 'teal'], ['Business|النشاط', 'Glow Salon|صالون جلو', '', 'navy'], ['Branch|الفرع', 'Salmiya|السالمية', 'Asia/Kuwait', 'sand']]],
    ['split', [
      ['panel', { title: 'Needs you today|يحتاج قرارك اليوم', list: [
        ['Leave requests waiting|طلبات إجازة بانتظار الاعتماد', '3', 'leave-approvals'],
        ['Attendance requests|طلبات الحضور', '2', 'att-requests'],
        ['Open attendance exceptions|تحذيرات حضور مفتوحة', '4', 'att-exceptions'],
        ['Documents expiring soon|وثائق تنتهي قريبًا', '1', 'employees']] }],
      ['table', { title: 'Today in Salmiya|اليوم في السالمية', cols: ['Time|الوقت', 'Customer|العميل', 'Service|الخدمة', 'Net (KWD)|الصافي (د.ك)'], rows: [
        [N('10:15'), 'Latifa Al-Sabah|لطيفة الصباح', SVC[0], N('8.000')],
        [N('11:00'), 'Reem Al-Kandari|ريم الكندري', SVC[1], N('35.000')],
        [N('11:40'), 'Aisha Behbehani|عائشة بهبهاني', SVC[2], N('6.500')]], acts: [A('Day list|قائمة اليوم', 'day', 'outline')] }]],
     [
      ['panel', { title: 'Quick actions|إجراءات سريعة', acts: [A('Record a visit|تسجيل زيارة', 'visit', 'primary'), A('Sell a package|بيع باقة', 'pkgsale', 'secondary'), A('Attendance board|لوحة الحضور', 'att-board', 'outline')] }],
      ['panel', { title: 'In now|موجودات الآن', list: [[EMP[0], 'Clock-in 09:02|دخول 09:02'], [EMP[1], 'Clock-in 09:10|دخول 09:10'], [EMP[3], 'Clock-in 09:31 · late 16 min|دخول 09:31 · تأخير 16 د']] }]]]] },

  /* ---------- sales ---------- */
  visit: { title: 'Record a visit|تسجيل زيارة', desc: 'One visit, its services, performers and discount.|زيارة واحدة بخدماتها ومنفذاتها وخصمها.', blocks: [
    ['split', [
      ['form', { sections: [
        { title: 'Recorder|المسجِّل', fields: [['Recorder membership|عضوية المسجِّل', 'select', ['Manager · Glow Salon|مديرة · صالون جلو', 'Reception · Salmiya|استقبال · السالمية']], ['Session time|وقت الجلسة', 'time', '11:40']] },
        CUSTOMER,
        { title: 'Service line 1|الخدمة 1', fields: [
          ['Service|الخدمة', 'select', SVC], ['Price (KWD)|السعر (د.ك)', 'num', '8.000'],
          ['Discount (%)|الخصم (%)', 'num', '10', 4], ['Discount amount (KWD)|مبلغ الخصم (د.ك)', 'num', '0.800', 4], ['From package|من باقة', 'check', false, 4],
          ['Performer|المنفذة', 'select', EMP], ['Share (%)|الحصة (%)', 'num', '100']] },
        { title: 'Service line 2|الخدمة 2', fields: [
          ['Service|الخدمة', 'select', [SVC[2], ...SVC]], ['Price (KWD)|السعر (د.ك)', 'num', '6.500'],
          ['Performer|المنفذة', 'select', [EMP[1], ...EMP]], ['Share (%)|الحصة (%)', 'num', '100']] }],
        submit: [A('Add service|إضافة خدمة', null, 'outline')] }]],
     [
      ['panel', { title: 'Draft summary|ملخص المسودة', sticky: true, kv: [['Service line 1|الخدمة 1', '7.200'], ['Service line 2|الخدمة 2', '6.500'], ['Discount|الخصم', '0.800'], ['Draft total (KWD)|إجمالي المسودة (د.ك)', '13.700']],
        text: 'Discount limit: 15% · source: Business default|حد الخصم: 15% · المصدر: افتراضي النشاط', acts: [A('Save visit|حفظ الزيارة', null, 'primary')] }],
      ['panel', { title: 'Rejected drafts|مسودات مرفوضة', text: 'No rejected drafts for this customer.|لا توجد مسودات مرفوضة لهذا العميل.' }]]]] },
  day: { title: 'Day list|قائمة اليوم', desc: 'Every visit recorded in this branch on one day.|كل الزيارات المسجلة في الفرع خلال يوم واحد.', actions: [A('Record a visit|تسجيل زيارة', 'visit', 'primary')], blocks: [
    ['table', { filters: [['Date|التاريخ', 'date', '2026-11-20'], ['Late only|المتأخرة فقط', 'check']], cols: ['Time|الوقت', 'Customer|العميل', 'Service|الخدمة', 'Performer|المنفذة', 'Price|السعر', 'Discount|الخصم', 'Net (KWD)|الصافي (د.ك)', 'State|الحالة', ''], rows: [
      [N('10:15'), 'Latifa Al-Sabah|لطيفة الصباح', SVC[0], EMP[0], N('8.000'), N('0.800'), N('7.200'), B('neutral', 'Saved|محفوظة'), A('Details|تفاصيل')],
      [N('10:15'), 'Latifa Al-Sabah|لطيفة الصباح', SVC[2], EMP[1], N('6.500'), N('0.000'), N('6.500'), B('info', 'Edited|معدّلة'), A('Details|تفاصيل')],
      [N('11:00'), 'Reem Al-Kandari|ريم الكندري', SVC[1], EMP[2], N('35.000'), N('3.500'), N('31.500'), B('warning', 'Late|متأخرة'), A('Details|تفاصيل')],
      [N('11:40'), 'Aisha Behbehani|عائشة بهبهاني', SVC[4], EMP[3], N('12.000'), N('0.000'), N('12.000'), B('danger', 'Cancelled|ملغاة'), A('History|السجل')]], foot: MORE }],
    ['panel', { title: 'Actions on a line|إجراءات على السطر', text: 'Open a line to edit price or discount, change performers, cancel, record a tip or extend a package. Each opens as a dialog over this list.|افتح السطر لتعديل السعر أو الخصم، تغيير المنفذات، الإلغاء، تسجيل إكرامية أو تمديد باقة. كل إجراء يفتح كنافذة فوق القائمة.', acts: [A('Edit price/discount|تعديل السعر/الخصم', null, 'outline'), A('Change performers|تغيير المنفذات', null, 'outline'), A('Record tip|تسجيل إكرامية', null, 'outline'), A('Cancel|إلغاء', null, 'destructive')] }]] },
  pkgsale: { title: 'Sell a package|بيع باقة', desc: 'Sell a prepaid package to a customer.|بيع باقة مدفوعة مسبقًا لعميل.', narrow: true, blocks: [
    ['form', { sections: [
      { title: 'Recorder|المسجِّل', fields: [['Recorder membership|عضوية المسجِّل', 'select', ['Manager · Glow Salon|مديرة · صالون جلو']], ['Seller employee|الموظفة البائعة', 'select', EMP]] },
      CUSTOMER,
      { title: 'Package|الباقة', fields: [['Package type|نوع الباقة', 'select', ['Hair care · 6 sessions · 60 days|عناية بالشعر · 6 جلسات · 60 يومًا', 'Nails · 10 sessions · 90 days|أظافر · 10 جلسات · 90 يومًا'], 12], ['Price paid (KWD)|المبلغ المدفوع (د.ك)', 'num', '120.000'], ['Payment method|طريقة الدفع', 'select', ['Cash|نقدًا', 'Card|بطاقة']]] }],
      submit: [A('Sell package|بيع الباقة', null, 'primary')] }]] },

  /* ---------- catalog ---------- */
  services: { title: 'Services|الخدمات', desc: 'The business menu: price, commission rule and whether the service counts toward tiers.|قائمة النشاط: السعر وقاعدة العمولة وهل تُحتسب الخدمة في الشرائح.', actions: [A('Add service|إضافة خدمة', 'service-new', 'primary')], blocks: [
    ['table', { filters: [['Search services|بحث في الخدمات', 'search'], ['Filter by category|تصفية بالتصنيف', 'select', ['All categories|كل التصنيفات', 'Hair|الشعر', 'Nails|الأظافر', 'Skin|البشرة']]], cols: ['English name|الاسم بالإنجليزية', 'Price (KWD)|السعر (د.ك)', 'Duration|المدة', 'Category|التصنيف', 'Commission rule|قاعدة العمولة', ''], rows: [
      [SVC[0], N('8.000'), '30 min|30 د', 'Hair|الشعر', 'Follow plan|حسب الخطة', A('Edit|تعديل', 'service-new')],
      [SVC[1], N('35.000'), '120 min|120 د', 'Hair|الشعر', 'Percentage 12%|نسبة 12%', A('Edit|تعديل', 'service-new')],
      [SVC[2], N('6.500'), '45 min|45 د', 'Nails|الأظافر', 'Follow plan|حسب الخطة', A('Edit|تعديل', 'service-new')],
      [SVC[3], N('7.500'), '50 min|50 د', 'Nails|الأظافر', 'Fixed 0.500|ثابت 0.500', A('Edit|تعديل', 'service-new')],
      [[SVC[4], B('neutral', 'Closed|مغلقة')], N('12.000'), '60 min|60 د', 'Skin|البشرة', 'No commission|بدون عمولة', A('Edit|تعديل', 'service-new')]], foot: PAGER }]] },
  'service-new': { parent: 'services', title: 'Add service|إضافة خدمة', narrow: true, blocks: [
    ['form', { sections: [
      { title: 'Name|الاسم', fields: [['English name|الاسم بالإنجليزية', 'text', 'Hair treatment'], ['Arabic name (optional)|الاسم بالعربية (اختياري)', 'text', 'علاج شعر']] },
      { title: 'Price and time|السعر والمدة', fields: [['Price (KWD)|السعر (د.ك)', 'num', '15.000', 4], ['Duration (minutes)|المدة (دقائق)', 'num', '45', 4], ['Category|التصنيف', 'select', ['No category|بدون تصنيف', 'Hair|الشعر'], 4]] },
      { title: 'Commission|العمولة', fields: [['Commission rule|قاعدة العمولة', 'select', ['Follow plan|حسب الخطة', 'No commission|بدون عمولة', 'Percentage|نسبة', 'Fixed amount (KWD)|مبلغ ثابت (د.ك)']], ['Value|القيمة', 'num', ''], ['Counts toward accumulation|تُحتسب في التراكم', 'check', true, 12]] }],
      submit: [A('Back to services|رجوع للخدمات', 'services', 'outline'), A('Add service|إضافة خدمة', null, 'primary')] }]] },
  categories: { title: 'Categories|التصنيفات', desc: 'Manage service categories, their visibility and their open state.|إدارة تصنيفات الخدمات وظهورها وحالة فتحها.', actions: [A('Add category|إضافة تصنيف', null, 'primary')], blocks: [
    ['table', { toggle: ['Open|مفتوحة', 'Closed|مغلقة', 'All|الكل'], cols: ['Name|الاسم', 'Visibility|الظهور', 'State|الحالة', ''], rows: [
      ['Hair|الشعر', 'Whole business|كل النشاط', B('success', 'Open|مفتوح'), A('Open|فتح')],
      ['Nails|الأظافر', 'Whole business|كل النشاط', B('success', 'Open|مفتوح'), A('Open|فتح')],
      ['Skin|البشرة', 'Branch · Salmiya|فرع · السالمية', B('neutral', 'Closed|مغلق'), A('Open|فتح')]], foot: PAGER }]] },
  packages: { title: 'Package types|أنواع الباقات', desc: 'Packages available across all branches of this business.|الباقات المتاحة في كل فروع هذا النشاط.', actions: [A('Add package type|إضافة نوع باقة', 'package-new', 'primary')], blocks: [
    ['table', { cols: ['English name|الاسم بالإنجليزية', 'Price (KWD)|السعر (د.ك)', 'Validity (days)|الصلاحية (أيام)', 'Services|الخدمات', 'Selling|البيع', ''], rows: [
      ['Hair care|عناية بالشعر', N('120.000'), N('60'), N('3'), A('Stop selling|إيقاف البيع'), A('Edit|تعديل', 'package-new')],
      ['Nails|أظافر', N('55.000'), N('90'), N('2'), A('Stop selling|إيقاف البيع'), A('Edit|تعديل', 'package-new')],
      [['Bridal|العروس', B('neutral', 'Not on sale|غير معروضة')], N('300.000'), N('30'), N('5'), A('Resume selling|استئناف البيع'), A('Edit|تعديل', 'package-new')]], foot: PAGER }]] },
  'package-new': { parent: 'packages', title: 'Add package type|إضافة نوع باقة', narrow: true, blocks: [
    ['form', { sections: [
      { title: 'Package|الباقة', fields: [['English name|الاسم بالإنجليزية', 'text', ''], ['Arabic name (optional)|الاسم بالعربية (اختياري)', 'text', ''], ['Price (KWD)|السعر (د.ك)', 'num', ''], ['Validity (days)|الصلاحية (أيام)', 'num', '']] },
      { title: 'Package services|خدمات الباقة', fields: [['Service|الخدمة', 'select', ['Choose a service|اختر خدمة', ...SVC]], ['Sessions|الجلسات', 'num', '6'], ['Service|الخدمة', 'select', [SVC[5]]], ['Sessions|الجلسات', 'num', '6'], ['', 'button', 'Add service|إضافة خدمة', 12]] }],
      submit: [A('Back to package types|رجوع لأنواع الباقات', 'packages', 'outline'), A('Add package type|إضافة نوع باقة', null, 'primary')] }]] },

  /* ---------- team ---------- */
  employees: { title: 'Employees|الموظفون', desc: 'Manage employee records and working branches.|إدارة سجلات الموظفين وفروع العمل.', actions: [A('Create employee|إضافة موظف', 'employee-new', 'primary')], blocks: [
    ['table', { filters: [['Search by name or number|بحث بالاسم أو الرقم', 'search'], ['Branch|الفرع', 'select', ALLBR], ['Role|الدور', 'select', ['All roles|كل الأدوار', 'Stylist|مصففة', 'Reception|استقبال']]], cols: ['Name|الاسم', 'Employee number|الرقم الوظيفي', 'Role|الدور', 'Primary branch|الفرع الأساسي', 'Documents|الوثائق', ''], rows: [
      [EMP[0], N('1001'), B('brand', 'Manager|مديرة'), BRANCHES[0], B('success', 'Valid|سارية'), A('Open|فتح', 'employee')],
      [EMP[1], N('1002'), B('neutral', 'Stylist|مصففة'), BRANCHES[0], B('warning', 'Expiring soon|تنتهي قريبًا'), A('Open|فتح', 'employee')],
      [EMP[2], N('1003'), B('neutral', 'Stylist|مصففة'), BRANCHES[1], B('success', 'Valid|سارية'), A('Open|فتح', 'employee')],
      [EMP[3], N('1004'), B('neutral', 'Nail technician|فنية أظافر'), BRANCHES[0], B('danger', 'Expired|منتهية'), A('Open|فتح', 'employee')],
      [EMP[4], N('1005'), B('neutral', 'Reception|استقبال'), BRANCHES[2], B('success', 'Valid|سارية'), A('Open|فتح', 'employee')]], foot: PAGER }]] },
  'employee-new': { parent: 'employees', title: 'Create employee|إضافة موظف', narrow: true, blocks: [
    ['form', { sections: [
      { title: 'Identity|الهوية', fields: [['English name|الاسم بالإنجليزية', 'text', ''], ['Arabic name|الاسم بالعربية', 'text', ''], ['Employee number|الرقم الوظيفي', 'text', '', 6, 'Leave this blank to take the next number.|اتركه فارغًا لأخذ الرقم التالي.'], ['Existing user ID|معرّف مستخدم موجود', 'text', '']] },
      { title: 'Work|العمل', fields: [['Primary branch|الفرع الأساسي', 'select', BRANCHES], ['Role|الدور', 'select', ['Stylist|مصففة', 'Reception|استقبال', 'Manager|مديرة']], ['Hire date|تاريخ التعيين', 'date', '2026-11-20'], ['Contract end|نهاية العقد', 'date', '']] }],
      submit: [A('Back to employees|رجوع للموظفين', 'employees', 'outline'), A('Create employee|إضافة موظف', null, 'primary')] }]] },
  employee: { parent: 'employees', title: 'Sara Al-Enezi|سارة العنزي', desc: 'Employee 1002 · Stylist · Salmiya|موظفة 1002 · مصففة · السالمية', actions: [A('Reload employee|إعادة تحميل الموظف', null, 'outline')], blocks: [
    ['subtabs', [
      { t: 'Details|البيانات', blocks: [['form', { sections: [
        { title: 'Identity|الهوية', fields: [['English name|الاسم بالإنجليزية', 'text', 'Sara Al-Enezi'], ['Arabic name|الاسم بالعربية', 'text', 'سارة العنزي'], ['Employee number|الرقم الوظيفي', 'text', '1002', 4], ['Role|الدور', 'select', ['Stylist|مصففة'], 4], ['Existing user ID|معرّف مستخدم موجود', 'text', '', 4]] },
        { title: 'Work|العمل', fields: [['Primary branch|الفرع الأساسي', 'select', BRANCHES, 4], ['Hire date|تاريخ التعيين', 'date', '2024-03-01', 4], ['Contract end|نهاية العقد', 'date', '2027-02-28', 4], ['Salmiya|السالمية', 'check', true, 4], ['Hawally|حولي', 'check', true, 4], ['Jahra|الجهراء', 'check', false, 4], ['Branch change date (Gregorian)|تاريخ تغيير الفرع (ميلادي)', 'date', '']] }],
        submit: [A('Save changes|حفظ التغييرات', null, 'primary')] }]] },
      { t: 'Pay|الراتب والبنك', blocks: [
        ['table', { title: 'Monthly basic salary|الراتب الأساسي الشهري', cols: ['Effective from|ساري من', 'Monthly basic salary|الراتب الأساسي', 'Revision|المراجعة', 'Reason|السبب'], rows: [[N('2026-01-01'), N('450.000'), N('2'), 'Annual raise|زيادة سنوية'], [N('2024-03-01'), N('400.000'), N('1'), 'Hired|تعيين']], acts: [A('Set salary|تحديد الراتب', null, 'outline')] }],
        ['table', { title: 'Bank account (IBAN)|الحساب البنكي (IBAN)', cols: ['Revision|المراجعة', 'IBAN', 'Bank|البنك', 'Account holder name in English|اسم صاحب الحساب بالإنجليزية', 'Set at|تاريخ التحديد'], rows: [[N('1'), N('KW81 CBKU •••• •••• 0101'), 'NBK|الوطني', 'Sara Al-Enezi', N('2024-03-02')]], acts: [A('Save bank account|حفظ الحساب البنكي', null, 'outline')] }]] },
      { t: 'Hours and card|الدوام والبطاقة', blocks: [['split', [
        ['form', { sections: [{ title: 'Default working hours|ساعات العمل الافتراضية', hint: 'Saturday to Friday. Leave a day empty for a day off.|من السبت إلى الجمعة. اترك اليوم فارغًا للإجازة.', fields: [['Saturday|السبت', 'text', '09:00 – 17:00', 4], ['Sunday|الأحد', 'text', '09:00 – 17:00', 4], ['Monday|الاثنين', 'text', '09:00 – 17:00', 4], ['Tuesday|الثلاثاء', 'text', '13:00 – 21:00', 4], ['Wednesday|الأربعاء', 'text', '13:00 – 21:00', 4], ['Thursday|الخميس', 'text', '09:00 – 17:00', 4], ['Friday|الجمعة', 'text', '', 4]] }], submit: [A('Clear default hours|مسح الساعات', null, 'outline'), A('Save default hours|حفظ الساعات', null, 'primary')] }]],
        [['panel', { title: 'Attendance card|بطاقة الحضور', kv: [['Card code|رمز البطاقة', 'GL-1002-A']], acts: [A('Issue card|إصدار بطاقة', null, 'outline'), A('Revoke card|إلغاء البطاقة', null, 'destructive')] }],
         ['panel', { title: 'Passkey|مفتاح المرور', text: 'Bound on 2026-08-14 from the staff app.|مربوط بتاريخ 2026-08-14 من تطبيق الموظفات.', acts: [A('Unbind passkey|فك ربط المفتاح', null, 'outline')] }]]]] },
      { t: 'Documents|الوثائق', blocks: [['table', { cols: ['Document type|نوع الوثيقة', 'Expires on|تنتهي في', 'Status|الحالة', ''], rows: [['Civil ID|البطاقة المدنية', N('2027-06-30'), B('success', 'Valid|سارية'), A('Open|فتح')], ['Health card|البطاقة الصحية', N('2026-12-05'), B('warning', 'Expiring soon|تنتهي قريبًا'), A('Replace|استبدال')], ['Contract|العقد', '—', B('neutral', 'No expiry|بدون انتهاء'), A('Open|فتح')]], acts: [A('Upload and record|رفع وتسجيل', null, 'outline')] }]] },
      { t: 'Leave|الإجازات', count: 1, blocks: [
        ['stats', [['Last annual|آخر سنوية', '2026-08-10'], ['Last sick|آخر مرضية', '2026-10-02'], ['Last unpaid|آخر بدون راتب', '—'], ['Last unexcused absence|آخر غياب بدون عذر', '—']]],
        ['table', { title: 'Upcoming and pending requests|الطلبات القادمة والمعلقة', cols: ['Date|التاريخ', 'Leave type|نوع الإجازة', 'Status|الحالة', 'Decision reason|سبب القرار', 'Decision|القرار'], rows: [[N('2026-12-01 → 12-05'), LEAVE_T[0], B('warning', 'Pending|معلّقة'), '—', A('Approve|اعتماد')]], acts: [A('Request leave on behalf|طلب إجازة بالنيابة', null, 'outline')] }]] }]]] },
  numbers: { title: 'Employee numbers|الأرقام الوظيفية', desc: 'Every employee in the company: name, business and number.|كل موظفي الشركة: الاسم والنشاط والرقم.', actions: [A('Start numbering from|بدء الترقيم من', null, 'outline')], blocks: [
    ['table', { filters: [['Search by name or number|بحث بالاسم أو الرقم', 'search']], cols: ['Name|الاسم', 'Business|النشاط', 'Employee number|الرقم الوظيفي', ''], rows: EMP.slice(0, 5).map((e, i) => [e, i < 4 ? 'Glow Salon|صالون جلو' : 'Glow Spa|سبا جلو', N(String(1001 + i)), A('Edit|تعديل')]) }]] },
  import: { title: 'Import employees|استيراد الموظفين', desc: 'Download the template, fill it, upload it and preview before committing.|نزّل القالب، املأه، ارفعه، وراجع قبل الاعتماد.', narrow: true, blocks: [
    ['steps', [['Download template|تنزيل القالب', 'An .xlsx file with the required columns.|ملف ‎.xlsx بالأعمدة المطلوبة.', A('Download template|تنزيل القالب', null, 'outline')], ['Upload the filled file|رفع الملف بعد تعبئته', 'employees-nov.xlsx · 14 rows|employees-nov.xlsx · 14 صفًا', A('Choose the filled .xlsx file|اختر ملف ‎.xlsx', null, 'outline')], ['Preview and commit|مراجعة واعتماد', '2 rows need fixing before you can commit.|صفّان يحتاجان تصحيحًا قبل الاعتماد.', A('Commit import|اعتماد الاستيراد', null, 'primary')]]],
    ['table', { title: 'Rows to fix|صفوف تحتاج تصحيحًا', cols: ['Row|الصف', 'Column|العمود', 'Reason|السبب'], rows: [[N('6'), 'Hire date|تاريخ التعيين', 'Not a valid date|تاريخ غير صحيح'], [N('11'), 'Primary branch|الفرع الأساسي', 'Unknown branch|فرع غير معروف']] }]] },
  doctypes: { title: 'Document types|أنواع الوثائق', desc: 'Types apply to the whole company. Each type sets its own expiry alert.|الأنواع تسري على الشركة كلها، ولكل نوع تنبيه انتهاء خاص.', actions: [A('Add type|إضافة نوع', null, 'primary')], blocks: [
    ['table', { cols: ['Document type|نوع الوثيقة', 'Alert days before expiry|أيام التنبيه قبل الانتهاء', 'Expiry date|تاريخ الانتهاء', 'State|الحالة', ''], rows: [['Civil ID|البطاقة المدنية', N('30'), 'Required|مطلوب', B('success', 'Active|فعّال'), A('Edit|تعديل')], ['Health card|البطاقة الصحية', N('45'), 'Required|مطلوب', B('success', 'Active|فعّال'), A('Edit|تعديل')], ['Contract|العقد', N('0'), 'Optional|اختياري', B('neutral', 'Inactive|غير فعّال'), A('Edit|تعديل')]] }]] },
  schedules: { title: 'Weekly schedules|جداول العمل الأسبوعية', desc: 'Saturday to Friday in the selected branch timezone.|من السبت إلى الجمعة بتوقيت الفرع المختار.', actions: [A('Reload|إعادة تحميل', null, 'outline')], blocks: [
    ['week', { start: '2026-11-21', rows: [[EMP[0], '09–17', '09–17', '09–17', '09–17', '09–17', '09–17', ''], [EMP[1], '09–17', '09–17', '09–17', '13–21', '13–21', '09–17', ''], [EMP[2], '13–21', '13–21', '', '13–21', '13–21', '13–21', '10–16'], [EMP[3], '09–17', '', '09–17', '09–17', '09–13', '09–17', '']] }]] },
  'schedule-rules': { title: 'Schedule settings|إعدادات الجداول', desc: 'How many shifts may start in one day, for the business and for each branch.|كم وردية يمكن أن تبدأ في اليوم، للنشاط ولكل فرع.', narrow: true, blocks: [
    ['form', { sections: [{ title: 'Business|النشاط', fields: [['Maximum shifts starting per day|أقصى عدد ورديات تبدأ يوميًا', 'num', '3', 6, 'Default: 3 shifts per day|الافتراضي: 3 ورديات يوميًا']] }], submit: [A('Save schedule settings|حفظ إعدادات الجداول', null, 'primary')] }],
    ['table', { title: 'Active branches|الفروع الفعّالة', cols: ['Branch|الفرع', "This branch's maximum shifts per day|أقصى ورديات الفرع يوميًا", 'Source|المصدر', ''], rows: [[BRANCHES[0], N('4'), B('brand', 'Branch number|رقم الفرع'), A('Use the business number|استخدم رقم النشاط')], [BRANCHES[1], N('3'), B('neutral', 'Business number|رقم النشاط'), A('Save branch number|حفظ رقم الفرع')], [BRANCHES[2], N('3'), B('neutral', 'Default number|الرقم الافتراضي'), A('Save branch number|حفظ رقم الفرع')]] }]] },

  /* ---------- attendance ---------- */
  'att-board': { title: 'Attendance board|لوحة الحضور', desc: 'Who is in now and how today went.|من الموجودات الآن وكيف سار اليوم.', blocks: [
    ['board', [
      { t: 'In now|موجودات الآن', n: 3, cards: [[EMP[0], '1001 · QR · 09:02 · still in 2:38|1001 · QR · 09:02 · مستمرة 2:38'], [EMP[1], '1002 · Card · 09:10 · still in 2:30|1002 · بطاقة · 09:10 · مستمرة 2:30'], [EMP[3], '1004 · Manual · 09:31 · late 16 min|1004 · يدوي · 09:31 · تأخير 16 د']] },
      { t: 'Not in yet|لم يحضرن بعد', n: 1, cards: [[EMP[2], 'Scheduled 13:00|مجدولة 13:00']] },
      { t: 'Refused clock attempts|محاولات تسجيل مرفوضة', n: 1, cards: [[EMP[4], 'Clock-in · outside branch range · 08:55|دخول · خارج نطاق الفرع · 08:55']] }]],
    ['table', { title: 'Daily attendance|الحضور اليومي', filters: [['Branch|الفرع', 'select', BRANCHES], ['Working date|تاريخ العمل', 'date', '2026-11-20']], cols: ['Employee|الموظف', 'Employee number|الرقم الوظيفي', 'Clock-in|الدخول', 'Clock-out|الخروج', 'Source|المصدر', 'Late minutes|دقائق التأخير', 'Status|الحالة', ''], rows: [
      [EMP[0], N('1001'), N('09:02'), '—', 'QR', N('0'), B('info', 'Open|مفتوح'), A('Correct time|تصحيح الوقت')],
      [EMP[3], N('1004'), N('09:31'), '—', 'Manual|يدوي', N('16'), B('info', 'Open|مفتوح'), A('Correct time|تصحيح الوقت')],
      [EMP[5], N('1006'), N('08:58'), N('17:04'), 'Card|بطاقة', N('0'), B('neutral', 'Closed|مغلق'), A('Correction history|سجل التصحيح')]] }]] },
  'att-exceptions': { title: 'Attendance exceptions|تحذيرات الحضور', desc: 'Late arrivals, missing clock-outs and other flags to acknowledge.|تأخير، خروج غير مسجل، وتحذيرات أخرى تحتاج إقرارًا.', blocks: [
    ['table', { toggle: ['Open|مفتوحة', 'Resolved|محلولة'], filters: [['Branch|الفرع', 'select', ALLBR]], cols: ['Employee|الموظف', 'Kind|النوع', 'Raised at|وقت التحذير', 'Clock-in|الدخول', 'Clock-out|الخروج', 'Reason|السبب', ''], rows: [
      [EMP[3], B('warning', 'Late|تأخير'), N('11-20 09:31'), N('09:31'), '—', '—', A('Resolve|حل')],
      [EMP[5], B('danger', 'Missing clock-out|خروج غير مسجل'), N('11-19 23:59'), N('09:00'), '—', '—', A('Resolve|حل')],
      [EMP[1], B('warning', 'Early leave|انصراف مبكر'), N('11-18 15:40'), N('09:05'), N('15:40'), '—', A('Resolve|حل')]], foot: MORE }]] },
  'att-requests': { title: 'Attendance requests|طلبات الحضور', desc: 'Manual days and day cancellations waiting for a decision.|أيام يدوية وإلغاءات أيام بانتظار القرار.', actions: [A('Manual day|يوم يدوي', null, 'primary')], blocks: [
    ['table', { filters: [['Branch|الفرع', 'select', ALLBR], ['Status|الحالة', 'select', ['All statuses|كل الحالات', 'Pending|معلّق', 'Approved|معتمد', 'Rejected|مرفوض', 'Withdrawn|مسحوب']]], cols: ['Employee|الموظف', 'Kind|النوع', 'Status|الحالة', 'Date|التاريخ', 'Reason|السبب', ''], rows: [
      [EMP[2], 'Manual day|يوم يدوي', B('warning', 'Pending|معلّق'), N('2026-11-18'), 'Phone was broken|الهاتف كان معطلاً', A('Approve|اعتماد')],
      [EMP[4], 'Cancel day|إلغاء يوم', B('warning', 'Pending|معلّق'), N('2026-11-17'), 'Clocked in by mistake|تسجيل بالخطأ', A('Approve|اعتماد')],
      [EMP[0], 'Manual day|يوم يدوي', B('success', 'Approved|معتمد'), N('2026-11-12'), 'Training outside|تدريب خارجي', A('Withdraw|سحب')]], foot: MORE }]] },
  'att-report': { title: 'Monthly attendance report|تقرير الحضور الشهري', desc: 'Hours are shown as h:mm.|الساعات معروضة بصيغة س:د.', actions: [A('Download CSV|تنزيل CSV', null, 'outline')], blocks: [
    ['table', { filters: [['Month|الشهر', 'month', '2026-11'], ['Branch|الفرع', 'select', ALLBR]], cols: ['Employee name|اسم الموظف', 'Employee number|الرقم الوظيفي', 'Days present|أيام الحضور', 'Worked hours|ساعات العمل', 'Scheduled hours|الساعات المجدولة', 'Leave|الإجازات', 'Difference|الفرق', 'Late count|مرات التأخير', 'Late minutes|دقائق التأخير', 'Missing clock-out|خروج غير مسجل', 'Manual days|أيام يدوية'], rows: [
      [EMP[0], N('1001'), N('17'), N('136:10'), N('136:00'), '—', B('success', '+0:10'), N('0'), N('0'), N('0'), N('1')],
      [EMP[1], N('1002'), N('15'), N('118:30'), N('120:00'), 'Sick 1 d|مرضية يوم', B('warning', '−1:30'), N('2'), N('21'), N('0'), N('0')],
      [EMP[3], N('1004'), N('16'), N('121:05'), N('128:00'), '—', B('danger', '−6:55'), N('5'), N('74'), N('1'), N('0')]] }]] },
  'att-statement': { title: 'Attendance statement|بيان الحضور', desc: 'A signed PDF statement for a branch or one employee.|بيان PDF موقّع لفرع أو لموظف واحد.', narrow: true, blocks: [
    ['form', { sections: [
      { title: 'What|ماذا', fields: [['Statement type|نوع البيان', 'select', ['Branch statement|بيان فرع', 'Employee statement|بيان موظف']], ['Branch|الفرع', 'select', BRANCHES], ['Employee|الموظف', 'select', ['All employees|كل الموظفين', ...EMP]], ['Shift|الوردية', 'select', ['All shifts|كل الورديات']]] },
      { title: 'When|متى', fields: [['Period|الفترة', 'select', ['Whole month|شهر كامل', 'Custom period|فترة مخصصة']], ['Month|الشهر', 'month', '2026-11'], ['Statement language|لغة البيان', 'select', ['Arabic|العربية', 'English|الإنجليزية']]] }],
      submit: [A('Request statement|طلب البيان', null, 'primary')] }]] },

  /* ---------- leave ---------- */
  'leave-approvals': { title: 'Leave approvals|اعتماد الإجازات', desc: 'Requests in the branches you are authorized for.|الطلبات في الفروع المصرح لك بها.', blocks: [
    ['table', { filters: [['Branch|الفرع', 'select', ['All authorized branches|كل الفروع المصرح بها', ...BRANCHES]], ['From date|من تاريخ', 'date', '2026-11-01'], ['Through date|إلى تاريخ', 'date', '2026-12-31']], cols: LEAVE_COLS, rows: [
      [N('12-01 → 12-05'), LEAVE_T[0], B('warning', 'Pending|معلّقة'), EMP[1], '—', A('Approve|اعتماد')],
      [N('11-24'), LEAVE_T[1], B('warning', 'Pending|معلّقة'), EMP[3], '—', A('Approve|اعتماد')],
      [N('11-27 13:00–17:00'), LEAVE_T[3], B('warning', 'Pending|معلّقة'), EMP[4], '—', A('Approve|اعتماد')],
      [N('11-10 → 11-12'), LEAVE_T[0], B('success', 'Approved|معتمدة'), EMP[0], 'Covered by Hessa|تغطية من حصة', A('Revoke approval|إلغاء الاعتماد')]], foot: PAGER }]] },
  'leave-history': { title: 'Leave history report|سجل الإجازات', desc: 'Leave and absence per employee over a period.|الإجازات والغياب لكل موظف خلال فترة.', blocks: [
    ['stats', [['Last annual|آخر سنوية', '2026-11-10'], ['Last sick|آخر مرضية', '2026-10-02'], ['Last unpaid|آخر بدون راتب', '2026-05-19'], ['Last unexcused absence|آخر غياب بدون عذر', '2026-09-30']]],
    ['table', { filters: [['Search employees|بحث في الموظفين', 'search'], ['Branch|الفرع', 'select', ALLBR], ['Leave type|نوع الإجازة', 'select', ['All types|كل الأنواع', ...LEAVE_T, 'Unexcused absence|غياب بدون عذر']], ['Status|الحالة', 'select', ['All statuses|كل الحالات', 'Absent|غائب']]], cols: ['Employee|الموظف', 'Branch|الفرع', 'Date|التاريخ', 'Leave type|نوع الإجازة', 'Status|الحالة', 'Decision reason|سبب القرار'], rows: [
      [EMP[0], BRANCHES[0], N('11-10 → 11-12'), LEAVE_T[0], B('success', 'Approved|معتمدة'), 'Covered by Hessa|تغطية من حصة'],
      [EMP[1], BRANCHES[0], N('10-02'), LEAVE_T[1], B('success', 'Approved|معتمدة'), '—'],
      [EMP[3], BRANCHES[0], N('09-30'), 'Unexcused absence|غياب بدون عذر', B('danger', 'Absent|غائب'), '—']], foot: PAGER }]] },

  /* ---------- setup ---------- */
  identity: { title: 'Business identity|هوية النشاط', desc: 'Official names and logo for this business.|الأسماء الرسمية والشعار لهذا النشاط.', blocks: [
    ['split', [['form', { sections: [{ title: 'Official names|الأسماء الرسمية', fields: [['Official Arabic name|الاسم الرسمي بالعربية', 'text', 'صالون جلو للسيدات', 12], ['Official English name|الاسم الرسمي بالإنجليزية', 'text', 'Glow Ladies Salon', 12]] }], submit: [A('Save names|حفظ الأسماء', null, 'primary')] }]],
      [['panel', { title: 'Logo|الشعار', logo: true, text: 'PNG or SVG, square, at least 512 px.|PNG أو SVG، مربع، 512 بكسل على الأقل.', acts: [A('Replace logo|استبدال الشعار', null, 'outline'), A('Remove logo|إزالة الشعار', null, 'destructive')] }]]]] },
  permissions: { title: 'Permissions|الصلاحيات', desc: 'Review role defaults and manage personal access decisions.|مراجعة افتراضيات الأدوار وإدارة قرارات الوصول الشخصية.', blocks: [
    ['subtabs', [
      { t: 'Memberships|العضويات', blocks: [['split', [
        ['table', { filters: [['Scope|النطاق', 'select', ['Business|النشاط', 'Company|الشركة']]], cols: ['Holder|صاحب العضوية', 'Role|الدور', 'Scope|النطاق', ''], rows: [['usr_8f2k…19', B('brand', 'Owner|مالك'), 'Company|الشركة', A('View|عرض')], ['usr_3ad1…7c', B('neutral', 'Manager|مدير'), 'Glow Salon|صالون جلو', A('View|عرض')], ['usr_c90e…42', B('neutral', 'Reception|استقبال'), 'Salmiya|السالمية', A('View|عرض')]], foot: PAGER }]],
        [['panel', { title: 'Manager · usr_3ad1…7c|مدير · usr_3ad1…7c', kv: [['Membership window|فترة العضوية', '2025-01-01 → No expiry|2025-01-01 ← بدون انتهاء'], ['Personal discount limit|حد الخصم الشخصي', '20%']], list: [['manage:orders:branch', 'Allow · Salmiya · until 2026-12-31|سماح · السالمية · حتى 2026-12-31'], ['manage:refunds:business', 'Deny · reason: trial period|منع · السبب: فترة تجربة']], acts: [A('Save override|حفظ الاستثناء', null, 'outline')] }]]]] },
      { t: 'Discount limits|حدود الخصم', blocks: [['form', { sections: [{ title: 'Default discount limit · Glow Salon|حد الخصم الافتراضي · صالون جلو', fields: [['Default discount limit (%)|حد الخصم الافتراضي (%)', 'num', '15'], ['Reason|السبب', 'text', '']] }], submit: [A('Clear discount limit|مسح حد الخصم', null, 'outline'), A('Save discount limit|حفظ حد الخصم', null, 'primary')] }]] }]]] },
  alerts: { title: 'Alerts|التنبيهات', desc: 'Who is told about what, per business or per branch.|من يُبلَّغ بماذا، للنشاط أو لكل فرع.', blocks: [
    ['form', { sections: [{ title: 'Scope|النطاق', fields: [['Rules scope|نطاق القواعد', 'select', ['Business rules|قواعد النشاط', ...BRANCHES]], ['Send rating requests to customers|إرسال طلبات التقييم للعملاء', 'check', true, 3], ['All team alerts on|كل تنبيهات الفريق مفعّلة', 'check', true, 3]] }] }],
    ['table', { title: 'Alert rules|قواعد التنبيه', cols: ['Alert|التنبيه', 'Source|المصدر', 'Recipients|المستلمون', 'Minutes|الدقائق'], rows: [
      ['Late clock-in|تأخر الدخول', B('neutral', 'Business|النشاط'), 'Manager, Owner|المدير، المالك', N('15')],
      ['Missing clock-out|خروج غير مسجل', B('neutral', 'Business|النشاط'), 'Manager|المدير', N('30')],
      ['Shift ending reminder|تذكير نهاية الوردية', B('brand', 'Branch|الفرع'), 'Employee|الموظف', N('10')],
      ['Document expiring|وثيقة تنتهي', B('neutral', 'Business|النشاط'), 'Owner|المالك', '—'],
      ['Discount approval requested|طلب اعتماد خصم', B('neutral', 'Business|النشاط'), 'Manager|المدير', '—'],
      ['Low rating received|تقييم منخفض', B('neutral', 'Business|النشاط'), 'Owner|المالك', '—']], acts: [A('Save|حفظ', null, 'primary')] }]] },
  applink: { title: 'Staff app|تطبيق الموظفات', desc: 'The link your team opens to clock in and see their statements.|الرابط الذي يفتحه فريقك لتسجيل الحضور ورؤية كشوفهم.', narrow: true, blocks: [
    ['panel', { qr: true, kv: [['Business|النشاط', 'Glow Salon|صالون جلو'], ['App link|رابط التطبيق', 'pos.pospay.systems/personal?b=glow']], acts: [A('Copy link|نسخ الرابط', null, 'primary'), A('Send on WhatsApp|إرسال عبر واتساب', null, 'outline')] }]] },
  appcols: { title: 'Staff app columns|أعمدة تطبيق الموظفين', desc: 'What each employee sees about her own work in the staff app.|ما تراه كل موظفة عن عملها في تطبيق الموظفات.', narrow: true, blocks: [
    ['form', { sections: [{ title: 'Columns|الأعمدة', fields: ['Date|التاريخ', 'Time|الوقت', 'Service|الخدمة', 'Customer name|اسم العميل', 'Price before discount|السعر قبل الخصم', 'Discount|الخصم', 'Net|الصافي', 'Her share|حصتها', 'Estimated commission|العمولة التقديرية', 'Tip|الإكرامية'].map((c, i) => [c, 'check', i !== 3 && i !== 4, 4]) }, { title: 'History|السجل', fields: [['Months back|عدد الأشهر السابقة', 'num', '3', 4, '1–12']] }], submit: [A('Save|حفظ', null, 'primary')] }]] },
  security: { title: 'Authenticator app|تطبيق المصادقة', desc: 'Two-step sign-in for your own account.|تسجيل دخول بخطوتين لحسابك.', narrow: true, blocks: [
    ['steps', [['Confirm your password|أكّد كلمة المرور', 'Needed before the QR code is shown.|مطلوب قبل إظهار رمز QR.', A('Continue|متابعة', null, 'primary')], ['Scan the QR code|امسح رمز QR', 'Use any authenticator app.|استخدم أي تطبيق مصادقة.'], ['Save your backup codes|احفظ رموز الاحتياط', 'Each code works once.|كل رمز يعمل مرة واحدة.', A('Copy codes|نسخ الرموز', null, 'outline')]]]] },
};
