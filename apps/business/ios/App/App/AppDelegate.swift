import UIKit
import Capacitor
import WebKit
import CryptoKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // خزنة جلسة الموظفة على iOS (ADR-0055 ملحق (f)، PP-65).
    // بتشتغل قبل ما الواجهة تتعمل، عشان ترجّع جلسة الموظفة من القرص قبل أول طلب.
    private let staffCookieVault = StaffSessionCookieVault()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        excludeAppStorageFromBackup()
        // لازم الاستعادة من القرص تسبق إنشاء الواجهة (SceneDelegate بيعمل CAPBridgeViewController)،
        // عشان أول طلب في التطبيق يلاقي كوكي الموظفة موجودة.
        staffCookieVault.start()
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause their game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

// بيانات كوكي جلسة الموظفة اللي بنحفظها على القرص.
// بنستخدم Codable + PropertyListEncoder صريح بدل cookie.properties،
// لأن properties نوعها [HTTPCookiePropertyKey: Any] وفيها NSURL، ومش Codable أصلاً.
private struct PersistedStaffCookie: Codable, Equatable {
    let name: String
    let value: String
    let domain: String
    let path: String
    let expiresDate: Date
    let isSecure: Bool
    let isHTTPOnly: Bool
    let sameSitePolicy: String?
    let version: Int
}

// خزنة جلسة الموظفة على iOS (ADR-0055 ملحق (f)، PP-65).
//
// ليه موجودة: اختبار iOS فشل في «الجلسة لازم تفضل بعد إعادة فتح التطبيق»
// لأن مخزن الكوكيز الأصلي (CFHTTPCookieStorage) بيكتب على القرص بشكل مؤجل،
// واختبار XCUIApplication.terminate() بيقتل العملية في نفس اللحظة اللي بتظهر فيها
// «الموظفة سجّلت دخولها»، فالكوكي ما بيوصلش للقرص. الكوكي نفسه سليم (عنده Expires)،
// المشكلة في توقيت الكتابة. فبنكتب نسخة على القرص من نفس لحظة تغيّر الكوكي.
//
// كمان في فخ تاني: CapacitorHttp.setCookiesFromResponse بيقسم ترويسة Set-Cookie
// عند الفاصلة وبيمرّر نص فاضي ("") لـ CapacitorCookieManager.setCookie، والـ ""
// ده بيتحل لـ capacitor://localhost (سيرفر التطبيق) — فبيطلع كوكي مكسور بنفس الاسم
// على localhost من غير تاريخ انتهاء (expiresDate == nil)، والكوكي السليم بيفضل
// متحفظ على دومين الـ API من URLSession الأصلي بالخصائص الصح.
// احنا بنفلتر الكوكي المكسور وبنمسحه؛ ولو ظهرت نسخة من غير Expires وبنفس التوكين
// الحالي والجلسة المحفوظة لسه صالحة، بنرجّع الكوكي السليم المحفوظ فوقها بدل ما
// نعتبرها تسجيل خروج ونمسح الجلسة.
//
// خطر كمان: WKWebView بيعمل copy-back للكوكي من مخزنه لمخزن الـ URLSession
// (CapacitorWKCookieObserver)، فبعد تسجيل الخروج الكوكي القديم ممكن يرجع تاني.
// عشان كده بنحتفظ ببصمات SHA-256 للتوكينات اللي خرجت (آخر 8 بس) ونرفض أي كوكي
// بصمته منهم، عشان ما يرجعش كأنه جلسة جديدة.
private final class StaffSessionCookieVault {

    // كوكي جلسة الموظفة بس. كوكي الجلسة الشخصية (pospay-personal.session_token)
    // ما بنحفظوش هنا عن قصد: ده بتاع M-1c-ii على أول آيفون حقيقي.
    private static let staffCookieName = "pospay-staff.session_token"
    private static let staffCookiePath = "/v1"
    private static let maxRetiredHashes = 8
    private static let activeCookieFileName = "pospay-staff-cookie.plist"
    private static let retiredHashesFileName = "pospay-staff-retired-hashes.plist"

    // القفل متكرر لأن setCookie و deleteCookie بينشروا نوتيفكيشن CookiesChanged متزامن،
    // والنوتيفكيشن بيرجع يدخل نفس الدالة تاني.
    private let lock = NSRecursiveLock()
    private var isSynchronizing = false
    private var currentCookie: PersistedStaffCookie?
    private var currentHash: String?
    private var lastWrittenData: Data?
    private var retiredHashes: [String] = []
    private var observerTokens: [NSObjectProtocol] = []

    func start() {
        // من غير .always ممكن المتصفح يقبل كوكي من دومين تاني واللوجن ما يبقاش شغال.
        HTTPCookieStorage.shared.cookieAcceptPolicy = .always

        // الاستعادة قبل تسجيل المراقب: لو سجّلنا المراقب الأول، setCookie جوه الاستعادة
        // هيعمل نوتيفكيشن والـ sync هيشوف المخزن فاضي ويحذف اللي رجعناه.
        restoreFromDisk()

        let center = NotificationCenter.default
        // queue: nil يعني المعالج بيشتغل مباشرة على نفس الخيط اللي بينشر الإشعار من غير تأخير لـ queue تاني في كودنا؛ والـ spike على محاكي iOS بيتأكد عملياً إن الحفظ لحق يخلص قبل app.terminate().
        observerTokens.append(center.addObserver(forName: Notification.Name.NSHTTPCookieManagerCookiesChanged, object: nil, queue: nil) { [weak self] _ in
            self?.syncFromSharedStorage()
        })
        // willResignActive و didEnterBackground محاولات رخيصة زيادة: بتضمن الحفظ
        // لما المستخدم يقفل التطبيق أو iOS ينزل التطبيق في الخلفية.
        observerTokens.append(center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: nil) { [weak self] _ in
            self?.syncFromSharedStorage()
        })
        observerTokens.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
            self?.syncFromSharedStorage()
        })
    }

    deinit {
        for token in observerTokens {
            NotificationCenter.default.removeObserver(token)
        }
    }

    // الملف على القرص هو المرجع، مش المخزن الأصلي ولا مخزن WKWebView:
    // لأن التطبيق اتقفل قبل ما المخزن الأصلي يكتب على القرص.
    private func restoreFromDisk() {
        lock.lock()
        defer { lock.unlock() }

        // لازم البصمات المتقاعدة تتحمّل من القرص الأول: هي اللي بتخلي
        // الكوكي القديم اللي WKWebView بيرجعه بعد الخروج مايرجعش كأنه جلسة جديدة.
        retiredHashes = loadRetiredHashes()

        guard let rawData = try? Data(contentsOf: Self.activeCookieFileURL()),
              let entry = try? PropertyListDecoder().decode(PersistedStaffCookie.self, from: rawData) else {
            clearPersistedStateAndStores()
            return
        }

        // التوكين المنتهي (أو غير الصالح) لازم بصمته تتقاعد قبل التنظيف:
        // وإلا رجع تاني من المخزن الأصلي بعد التشغيل كأنه جلسة جديدة.
        guard Self.isValidEntry(entry), !retiredHashes.contains(Self.sha256Hex(entry.value)) else {
            retireHashIfPresent(for: entry)
            clearPersistedStateAndStores()
            return
        }

        guard let restoredCookie = Self.makeCookie(from: entry) else {
            retireHashIfPresent(for: entry)
            clearPersistedStateAndStores()
            return
        }

        // نشيل أي كوكي قديم (قيمة مختلفة أو منتهي) من المخزن الأصلي قبل ما نحط الجديد.
        for cookie in Self.staffCookiesInSharedStorage() {
            if cookie.value != entry.value || (cookie.expiresDate ?? .distantPast) <= Date() {
                HTTPCookieStorage.shared.deleteCookie(cookie)
            }
        }
        HTTPCookieStorage.shared.setCookie(restoredCookie)

        // نتأكد إن الكوكي رجع فعلاً: لو اترفض (دومين غلط مثلاً) لازم نمسح الملف
        // ونمسح نسخة WebKit كمان، وإلا هيفضل كوكي قديم شغال بقيمة قديمة.
        let storedCookies = Self.probeURL(for: entry).flatMap { HTTPCookieStorage.shared.cookies(for: $0) } ?? []
        let isVerified = storedCookies.contains { $0.name == entry.name && $0.value == entry.value }
        guard isVerified else {
            retireHashIfPresent(for: entry)
            clearPersistedStateAndStores()
            return
        }

        currentCookie = entry
        currentHash = Self.sha256Hex(entry.value)
        lastWrittenData = rawData

        // نخلّي نسخة WKWebView بنفس الكوكي بالظبط.
        scheduleWebViewStoreSync()
    }

    // بتتنفّذ متزامن جوه نوتيفكيشن CookiesChanged، وده المطلوب:
    // الكتابة لازم تخلص قبل ما terminate() يقتل العملية.
    private func syncFromSharedStorage() {
        lock.lock()
        defer { lock.unlock() }

        // setCookie و deleteCookie بينشروا النوتيفكيشن متزامن، فالريكسر لازم يتقفل.
        guard !isSynchronizing else { return }
        isSynchronizing = true
        defer { isSynchronizing = false }

        var invalidOrExpired: [HTTPCookie] = []
        var resurrected: [HTTPCookie] = []
        var candidates: [HTTPCookie] = []
        // هل ظهر كوكي مؤقت (من غير تاريخ انتهاء) بنفس قيمة توكين الجلسة الحالية؟
        // لو ده حصل والجلسة المحفوظة لسه صالحة، لازم نرجّع الكوكي السليم
        // بدل ما نعتبرها تسجيل خروج ونمسح الجلسة.
        var sawCurrentTokenWithoutExpiry = false

        for cookie in Self.staffCookiesInSharedStorage() {
            guard Self.isLiveStaffCookie(cookie) else {
                // كوكي مكسور أو منتهي: لو هو نفس توكين الجلسة الحالية بس من غير
                // تاريخ انتهاء، نعلّمه علشان نرجّع الجلسة السليمة قبل ما نمسحها.
                if let expectedHash = currentHash,
                   !cookie.value.isEmpty,
                   cookie.expiresDate == nil,
                   Self.sha256Hex(cookie.value) == expectedHash {
                    sawCurrentTokenWithoutExpiry = true
                }
                invalidOrExpired.append(cookie)
                continue
            }
            if retiredHashes.contains(Self.sha256Hex(cookie.value)) {
                resurrected.append(cookie)
                continue
            }
            candidates.append(cookie)
        }

        for cookie in invalidOrExpired + resurrected {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }

        // 1 — جلسة جديدة من تسجيل دخول جديد: كوكي مخالف للبصمة المحفوظة.
        // قاعدة الأقدمية: المرشح الجديد يقدّم على الجلسة الحالية بس لو تاريخ
        // انتهاءه بعد تاريخ انتهاء الجلسة الحالية (أو مساوي ليها). أي مرشح أقدم
        // من كده توكين قديم رجع من WKWebView بعد ما عدّى حد البصمات المتقاعدة،
        // فنتقاعد بصمته ونمسحه بدل ما يستبدل الجلسة الأحدث.
        let activeSession: PersistedStaffCookie? = currentCookie.flatMap { entry -> PersistedStaffCookie? in
            Self.isValidEntry(entry) ? entry : nil
        }
        var freshCandidates: [HTTPCookie] = []
        var staleCandidates: [HTTPCookie] = []
        for candidate in candidates where Self.sha256Hex(candidate.value) != currentHash {
            if let active = activeSession,
               (candidate.expiresDate ?? .distantPast) < active.expiresDate {
                staleCandidates.append(candidate)
            } else {
                freshCandidates.append(candidate)
            }
        }

        for cookie in staleCandidates {
            retire(hash: Self.sha256Hex(cookie.value))
            resurrected.append(cookie)
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }

        if let chosen = freshCandidates.max(by: { ($0.expiresDate ?? .distantPast) < ($1.expiresDate ?? .distantPast) }) {
            // البصمة القديمة تتقاعد عشان الكوكي القديم ما يرجعش بعد تسجيل الخروج.
            if let previousHash = currentHash {
                retire(hash: previousHash)
            }
            for cookie in candidates where cookie.value != chosen.value {
                HTTPCookieStorage.shared.deleteCookie(cookie)
            }
            guard let entry = Self.persistedEntry(from: chosen) else { return }
            currentCookie = entry
            currentHash = Self.sha256Hex(entry.value)
            persist(entry)
            if !resurrected.isEmpty {
                scheduleWebViewStoreSync()
            }
            return
        }

        // 2 — الجلسة لسه شغالة: نفس الكوكي لسه موجود في المخزن الأصلي.
        if let live = candidates.first(where: { Self.sha256Hex($0.value) == currentHash }) {
            if let entry = Self.persistedEntry(from: live) {
                currentCookie = entry
                persist(entry)
            }
            if !resurrected.isEmpty {
                scheduleWebViewStoreSync()
            }
            return
        }

        // لو طلع كوكي مؤقت من غير Expires وبنفس التوكين الحالي (بسبب تقسيم الفاصلة أو نسخ من WebView)،
        // والجلسة الحالية لسه صالحة وما خلصتش: نرجّع الكوكي السليم المحفوظ بدل ما نمسح الجلسة.
        if sawCurrentTokenWithoutExpiry,
           let active = currentCookie,
           Self.isValidEntry(active),
           let rebuilt = Self.makeCookie(from: active) {
            HTTPCookieStorage.shared.setCookie(rebuilt)
            scheduleWebViewStoreSync()
            return
        }

        // 3 — مفيش جلسة صالحة: تسجيل خروج أو انتهاء صلاحية.
        let wasActive = currentHash != nil
        if let hash = currentHash {
            retire(hash: hash)
            currentCookie = nil
            currentHash = nil
            lastWrittenData = nil
        }
        try? FileManager.default.removeItem(at: Self.activeCookieFileURL())
        if wasActive || !resurrected.isEmpty || !invalidOrExpired.isEmpty {
            scheduleWebViewStoreSync()
        }
    }

    // تنظيف كامل: الملف على القرص، والمخزن الأصلي، ونسخة WKWebView.
    private func clearPersistedStateAndStores() {
        try? FileManager.default.removeItem(at: Self.activeCookieFileURL())
        currentCookie = nil
        currentHash = nil
        lastWrittenData = nil
        for cookie in Self.staffCookiesInSharedStorage() {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
        scheduleWebViewStoreSync()
    }

    private func persist(_ entry: PersistedStaffCookie) {
        guard let data = try? PropertyListEncoder().encode(entry) else { return }
        guard data != lastWrittenData else { return }
        guard Self.write(data: data, to: Self.activeCookieFileURL()) else { return }
        lastWrittenData = data
    }

    // بنسجل البصمة بس (مش التوكين) عشان نعرف إن الكوكي ده خرج.
    private func retire(hash: String) {
        retiredHashes.removeAll { $0 == hash }
        retiredHashes.append(hash)
        if retiredHashes.count > Self.maxRetiredHashes {
            retiredHashes.removeFirst(retiredHashes.count - Self.maxRetiredHashes)
        }
        guard let data = try? PropertyListEncoder().encode(retiredHashes) else { return }
        Self.write(data: data, to: Self.retiredHashesFileURL())
    }

    // بصمة التوكين بتتقاعد بس لو التوكين نفسه مش فاضي.
    private func retireHashIfPresent(for entry: PersistedStaffCookie) {
        guard !entry.value.isEmpty else { return }
        retire(hash: Self.sha256Hex(entry.value))
    }

    private func loadRetiredHashes() -> [String] {
        guard let data = try? Data(contentsOf: Self.retiredHashesFileURL()),
              let hashes = try? PropertyListDecoder().decode([String].self, from: data) else { return [] }
        return Array(hashes.suffix(Self.maxRetiredHashes))
    }

    // الحماية من الملفات: نفس مستوى حماية مخزن الكوكيز الأصلي،
    // والملف ميتنسخش مع نسخة iCloud ولا مع نسخة الجهاز.
    @discardableResult
    private static func write(data: Data, to url: URL) -> Bool {
        do {
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            var resourceValues = URLResourceValues()
            resourceValues.isExcludedFromBackup = true
            var mutableUrl = url
            try? mutableUrl.setResourceValues(resourceValues)
            return true
        } catch {
            // الكتابة فشلت: التطبيق يفضل شغال بجلسة الويب، والخطأ ده مالوش حل تاني هنا.
            return false
        }
    }

    // الملفات جوّه Library/Application Support — نفس المجلد اللي excludeAppStorageFromBackup()
    // بيعمله وبيستثنيه من النسخ الاحتياطي.
    private static func storageDirectory() -> URL {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private static func activeCookieFileURL() -> URL {
        storageDirectory().appendingPathComponent(activeCookieFileName)
    }

    private static func retiredHashesFileURL() -> URL {
        storageDirectory().appendingPathComponent(retiredHashesFileName)
    }

    private static func staffCookiesInSharedStorage() -> [HTTPCookie] {
        (HTTPCookieStorage.shared.cookies ?? []).filter { $0.name == staffCookieName }
    }

    // الخصائص بتتبني من الحقول المحفوظة بالظبط، من غير ما نضيف ولا نعدّل ولا نخفي سمة:
    // الـ API بيبعت HttpOnly; Secure; SameSite=Lax; Path=/v1، وأي اختلاف في الخصائص
    // يبقى تعديل على عقد الجلسة (ADR-0055 ملحق (e)).
    private static func makeCookie(from entry: PersistedStaffCookie) -> HTTPCookie? {
        var properties: [HTTPCookiePropertyKey: Any] = [
            .name: entry.name,
            .value: entry.value,
            .domain: entry.domain,
            .path: entry.path,
            .expires: entry.expiresDate,
            .version: String(entry.version)
        ]
        if entry.isSecure {
            properties[.secure] = "TRUE"
        }
        if entry.isHTTPOnly {
            properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE"
        }
        if let sameSite = entry.sameSitePolicy, !sameSite.isEmpty {
            properties[.sameSitePolicy] = HTTPCookieStringPolicy(rawValue: sameSite)
        }
        return HTTPCookie(properties: properties)
    }

    private static func persistedEntry(from cookie: HTTPCookie) -> PersistedStaffCookie? {
        guard let expiresDate = cookie.expiresDate else { return nil }
        return PersistedStaffCookie(
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            expiresDate: expiresDate,
            isSecure: cookie.isSecure,
            isHTTPOnly: cookie.isHTTPOnly,
            sameSitePolicy: cookie.sameSitePolicy?.rawValue ?? sameSitePolicy(from: cookie.properties),
            version: cookie.version
        )
    }

    private static func sameSitePolicy(from properties: [HTTPCookiePropertyKey: Any]?) -> String? {
        guard let value = properties?[.sameSitePolicy] else { return nil }
        if let policy = value as? HTTPCookieStringPolicy { return policy.rawValue }
        if let text = value as? String { return text }
        return nil
    }

    // القاعدة الواحدة، وبتتحقق منها على الكوكي المحفوظ في الملف وعلى الكوكي في المخزن الأصلي:
    // HttpOnly و Secure و على Path=/v1 و دومينه مش localhost و قيمته مش فاضية
    // و تاريخ انتهائه في المستقبل. أي حاجة كده معناها الكوكي ده مش بتاع الجلسة الصح.
    private static func isValidEntry(_ entry: PersistedStaffCookie) -> Bool {
        entry.name == staffCookieName
            && !entry.value.isEmpty
            && entry.isHTTPOnly
            && entry.isSecure
            && entry.path == staffCookiePath
            && entry.domain != "localhost"
            && !entry.domain.isEmpty
            && entry.expiresDate > Date()
    }

    private static func isLiveStaffCookie(_ cookie: HTTPCookie) -> Bool {
        guard let entry = persistedEntry(from: cookie) else { return false }
        return isValidEntry(entry)
    }

    private static func probeURL(for entry: PersistedStaffCookie) -> URL? {
        let scheme = entry.isSecure ? "https" : "http"
        let host = entry.domain.hasPrefix(".") ? String(entry.domain.dropFirst()) : entry.domain
        return URL(string: "\(scheme)://\(host)\(entry.path)")
    }

    // بصمة SHA-256 للتوكين: بنخزّن البصمة بس، عمرنا ما بنخزّن قيمة التوكين ولا جزء منه.
    private static func sha256Hex(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    // مزامنة مخزن WKWebView مع الحالة الحالية للخزنة (تحت القفل) داخل نفس callback بتاع getAllCookies
    // وبعد setCookie، عشان نمنع سباق الخروج لو اتلغت الجلسة أثناء استرجاع معلّق.
    private func scheduleWebViewStoreSync() {
        DispatchQueue.main.async { [weak self] in
            self?.reconcileWebViewStoreOnMain()
        }
    }

    private func reconcileWebViewStoreOnMain() {
        let store = WKWebsiteDataStore.default().httpCookieStore
        store.getAllCookies { [weak self] cookies in
            guard let self = self else { return }
            let desiredCookie = self.activeCookieForWebViewStore()
            for existing in cookies where existing.name == Self.staffCookieName {
                if desiredCookie?.value != existing.value {
                    store.delete(existing, completionHandler: nil)
                }
            }
            guard let target = desiredCookie else { return }
            store.setCookie(target) { [weak self] in
                guard let self = self else { return }
                let latest = self.activeCookieForWebViewStore()
                if latest == nil {
                    store.delete(target, completionHandler: nil)
                } else if let replacement = latest, replacement.value != target.value {
                    store.setCookie(replacement, completionHandler: nil)
                }
            }
        }
    }

    private func activeCookieForWebViewStore() -> HTTPCookie? {
        lock.lock()
        defer { lock.unlock() }
        guard let entry = currentCookie,
              Self.isValidEntry(entry),
              !retiredHashes.contains(Self.sha256Hex(entry.value)) else {
            return nil
        }
        return Self.makeCookie(from: entry)
    }
}

// اعتماد الجهاز وبيانات النشاط والكوكيز ما يسافروش مع نسخة iCloud ولا مع نسخة الجهاز:
// موبايل متنسوخ ما يجيبش معاه اعتماد كاونتر شغّال ولا session cookie (spec 065 FR-013).
private func excludeAppStorageFromBackup() {
    guard let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else {
        return
    }
    for directory in ["WebKit", "Application Support", "Cookies"] {
        let url = library.appendingPathComponent(directory, isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        var mutableUrl = url
        try? mutableUrl.setResourceValues(resourceValues)
    }
}
