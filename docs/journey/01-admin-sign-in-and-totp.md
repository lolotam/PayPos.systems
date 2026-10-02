# 01 · Admin sign-in and the authenticator app — دخول لوحة الإدارة وتطبيق المصادقة

**Status / الحالة:** shipped in #53 (PR 2). Local only until the admin app is deployed (issue #54).

**Before you start / قبل ما تبدأ:** [00 Local setup](00-local-setup.md); an owner user with email and password;
an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password …).

## العربي

1. افتح `http://localhost:3001` ← هيحوّلك على صفحة **تسجيل الدخول**.
   **لازم تشوف:** الصفحة بالعربي ومن اليمين للشمال، فيها خانة الإيميل والباسورد وزرار **دخول**.
2. اكتب إيميل غلط الشكل ودوس **دخول** ← لازم تشوف رسالة إن الإيميل مش صحيح، ومفيش طلب بيتبعت.
3. اكتب الإيميل والباسورد الصح ودوس **دخول**.
   - لو المصادقة مش مفعّلة: هتدخل على **مساحة العمل** على طول.
   - لو مفعّلة: هتروح لصفحة **رمز التحقق**.
4. **تفعيل تطبيق المصادقة:** من فوق دوس **المصادقة** ← اكتب الباسورد ← **متابعة**.
   **لازم تشوف:** كود QR + مفتاح يدوي + أكواد احتياطية (احفظها) ← امسح الـ QR بالتطبيق ← اكتب الرقم المكوّن
   من 6 أرقام ← تظهر رسالة إن التطبيق اتفعّل.
5. اعمل **تسجيل الخروج** وادخل تاني ← بعد الباسورد هتطلب منك **رمز التحقق** ← اكتب رقم غلط ← رسالة إن الرمز
   مش صحيح ← اكتب الرقم الصح من التطبيق ← **تحقق** ← تدخل **مساحة العمل**.
6. غيّر اللغة لإنجليزي من فوق ← كل الصفحة تتحول إنجليزي ومن الشمال لليمين.

**ممنوع يحصل:** الدخول من غير الرقم بعد ما المصادقة اتفعّلت؛ ظهور الباسورد أو الرمز في أي رسالة.

## English

1. Open `http://localhost:3001` → redirected to **Sign in** (Arabic: تسجيل الدخول), right-to-left, with
   **Email**, **Password** and the **Sign in** button (دخول).
2. Enter a malformed email and press **Sign in** → "Enter a valid email." and no request is sent.
3. Enter the right email and password → without TOTP you land on **Workspace** (مساحة العمل); with TOTP you
   get **Verification code** (رمز التحقق).
4. Turn TOTP on: top bar **Authenticator** (المصادقة) → enter the password → **Continue** (متابعة) → you see a QR
   code ("Scan this code"), a manual key ("Or enter this key") and **Backup codes** → scan, enter a 6-digit code
   → "The authenticator app is on."
5. **Sign out** (تسجيل الخروج), sign in again → **Verification code** → a wrong code shows "That code is not
   valid." → the right code + **Verify** (تحقق) → **Workspace**.
6. Switch the language to English in the top bar → the whole page turns English and left-to-right.

**Must NOT happen:** signing in without the code once TOTP is on; a password or code shown in any message.

## For an agent

- Find elements by role and visible text: `button "دخول" | "Sign in"`, `button "تحقق" | "Verify"`.
- Assert `html[dir="rtl"]` in Arabic and `html[dir="ltr"]` after switching to English.
- The TOTP code needs the secret shown in step 4 ("Or enter this key"): compute it with any RFC 6238 library.
