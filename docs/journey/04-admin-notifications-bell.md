# 04 · The notifications bell — جرس الإشعارات

**Status / الحالة:** shipped in #58 (PR 4b). Local only for now. No feature sends in-app notifications yet, so the
test notification in step 1 is inserted by Claude.

**Before you start / قبل ما تبدأ:** signed in with a company chosen ([01](01-admin-sign-in-and-totp.md),
[02](02-admin-workspace-selector.md)); a second user in the same company for step 6.

## العربي

1. Claude يضيف إشعارين تجريبيين للمستخدم ده في الشركة المختارة.
2. خلال دقيقة بالكتير الجرس اللي فوق يظهر عليه رقم **2**.
3. دوس على الجرس ← قائمة **الإشعارات** فيها الإشعارين وعليهم **غير مقروء**.
4. دوس **تحديد كمقروء** على واحد ← يتحول **مقروء** والرقم يبقى **1**.
5. دوس **تحديد الكل كمقروء** ← الرقم يختفي.
6. اعمل تسجيل خروج وادخل بالمستخدم التاني من نفس المتصفح ← **ما يشوفش** إشعارات الأول.
7. افتح تبويبين؛ اعمل تسجيل خروج من واحد ← التاني يعمل reload لوحده.
8. مفيش إشعارات: تظهر **لا توجد إشعارات بعد.**

**ممنوع يحصل:** مستخدم يشوف إشعارات مستخدم تاني أو شركة تانية، حتى لثانية بعد تغيير الحساب.

## English

1. Claude inserts two test notifications for this user in the chosen company.
2. Within a minute the bell in the top bar shows **2**.
3. Click the bell → **Notifications** (الإشعارات) lists both as **Unread** (غير مقروء).
4. **Mark read** (تحديد كمقروء) on one → it becomes **Read** (مقروء); the badge shows **1**.
5. **Mark all read** (تحديد الكل كمقروء) → the badge disappears.
6. Sign out and sign in as the second user in the same browser → none of the first user's notifications appear.
7. With two tabs open, sign out in one → the other reloads by itself.
8. With no notifications: "No notifications yet." (لا توجد إشعارات بعد.)

**Must NOT happen:** a user seeing another user's or another company's notifications, even briefly after switching.

## For an agent

- The bell is a button with the lucide Bell icon and the unread count as its badge.
- API: `GET /v1/me/notifications/unread-count` with `x-company-id` must equal the badge.
