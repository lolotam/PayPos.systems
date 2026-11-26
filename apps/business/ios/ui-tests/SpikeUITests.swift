import XCTest
import WebKit

// البيئة التجريبية بس: الاختبار بيشغّل التطبيق المتثبّت على المحاكي بالـ bundle id بتاعه، ومش بيبنيه
// (spec 065، صف M-1c). اللغة إنجليزي عشان النصوص تبقى ثابتة مهما كانت لغة المحاكي.
final class SpikeUITests: XCTestCase {
  private let bundleId = "systems.pospay.business.staging"
  private let staffCookieName = "pospay-staff.session_token"
  private let syntheticCookieValue = "synthetic-cookie-value"
  private let staffCookieUrl = URL(string: "https://api.staging.pospay.systems/v1")!

  override func setUp() {
    continueAfterFailure = false
  }

  private func launchApp() -> XCUIApplication {
    let app = XCUIApplication(bundleIdentifier: bundleId)
    app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
    app.launch()
    return app
  }

  private func element(_ app: XCUIApplication, containing text: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
  }

  private func pasteField(_ app: XCUIApplication) -> XCUIElement {
    app.webViews.textFields.firstMatch
  }

  private func assertPasteFieldReady(_ app: XCUIApplication, _ moment: String) {
    XCTAssertTrue(
      element(app, containing: "Paste the link your manager sent you").waitForExistence(timeout: 60),
      "The employee paste label should be visible \(moment)"
    )
    XCTAssertTrue(
      pasteField(app).waitForExistence(timeout: 60),
      "The employee paste field should be visible \(moment)"
    )
    let hittable = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isHittable == true"), object: pasteField(app))
    XCTAssertEqual(
      XCTWaiter().wait(for: [hittable], timeout: 30),
      .completed,
      "The employee paste field should be hittable \(moment)"
    )
  }

  // الاتنين فحوصات في اختبار واحد لأن التاني محتاج الحالة اللي الأول بيسيبها، وXCTest مش بيضمن ترتيب الاختبارات.
  func testStartScreenAndEmployeeChoiceSurviveRestart() {
    var app = launchApp()

    XCTAssertTrue(
      element(app, containing: "How do you use this device?").waitForExistence(timeout: 60),
      "The start screen title should be visible"
    )
    XCTAssertTrue(
      element(app, containing: "Counter device").waitForExistence(timeout: 60),
      "The counter-device choice should be visible"
    )
    XCTAssertTrue(
      element(app, containing: "My employee account").waitForExistence(timeout: 60),
      "The employee-account choice should be visible"
    )
    element(app, containing: "My employee account").tap()
    assertPasteFieldReady(app, "after choosing the employee flow")

    app.terminate()
    app = launchApp()

    assertPasteFieldReady(app, "after an app restart")
    XCTAssertFalse(
      element(app, containing: "How do you use this device?").exists,
      "The start screen should not return after the employee choice was saved"
    )
  }

  // الفحص ده بيقفل السبب الحقيقي وراء «الجلسة لازم تفضل بعد إعادة فتح التطبيق»:
  // HTTPCookie(properties:) مفيهوش مفتاح HttpOnly، فالكوكي اللي بيتعمل منه بيبقى ناقص
  // HttpOnly وبيفشل تحقق خزنة الجلسة وبيتمسح. لازم نأكد إن الكوكي بيفضل HttpOnly
  // وله تاريخ انتهاء بعد ما يمر بالمخزن الأصلي وبعد ما يرجع من مخزن WebKit.
  // الفشل اللي سبّبه: سبايك الـ merge بتاع PR #1319 وقف عند «Staff sign-in should succeed».
  //
  // نطاق الفحص: بيتأكد من سلوك المنصة على المحاكي بس — Foundation
  // (HTTPCookie.cookies(withResponseHeaderFields:for:)) و WKWebsiteDataStore —
  // اللي بيعتمد عليهم StaffSessionCookieVault.makeCookie. الفحص ده مش بيختبر
  // StaffSessionCookieVault نفسها من طرف لطرف؛ القبول النهائي للإصلاح (خطوات إعادة
  // التشغيل وتسجيل الخروج) بيبقى في CounterAuthUITests على main.
  func testStaffCookieHttpOnlyPreservedAfterStorageAndWebKitSync() {
    // من غير .always ممكن المتصفح يقبل كوكي من دومين تاني واللوجن ما يبقاش شغال.
    HTTPCookieStorage.shared.cookieAcceptPolicy = .always
    // التنظيف بيتنقل من tearDown() جوه الدالة دي: tearDown كان بيستنى 20 ثانية على
    // WKWebsiteDataStore لكل اختبار — حتى للاختبارات اللي مش بتعمل كوكي صناعي —
    // وكان بيفشل في CI. الـ defer بيشتغل في كل الأحوال (حتى لو الاختبار فشل).
    defer { removeSyntheticStaffCookies() }
    let cases: [(domainAttribute: String?, expectedDomain: String)] = [
      (nil, "api.staging.pospay.systems"),
      (".staging.pospay.systems", ".staging.pospay.systems")
    ]
    for testCase in cases {
      removeSyntheticStaffCookies()
      guard let cookie = makeSyntheticStaffCookie(domainAttribute: testCase.domainAttribute) else {
        XCTFail("The synthetic staff cookie should be built for \(testCase.expectedDomain)")
        continue
      }
      assertStaffCookieInSharedStorage(cookie, domain: testCase.expectedDomain)
      assertStaffCookieSurvivesWebKitSync(cookie, domain: testCase.expectedDomain)
    }
  }

  // الكوكي بيتبنى من ترويسة Set-Cookie زي ما الـ API بيبعتها بالظبط
  // (Path=/v1; Expires; Secure; HttpOnly; SameSite=Lax)، عشان الفحص يقيس السلوك
  // الحقيقي على Foundation مش على ترويسة مفبركة.
  private func makeSyntheticStaffCookie(domainAttribute: String?) -> HTTPCookie? {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
    let expires = formatter.string(from: Date().addingTimeInterval(3600))
    var attributes = [
      "Path=/v1",
      "Expires=\(expires)",
      "Secure",
      "HttpOnly",
      "SameSite=Lax"
    ]
    if let domainAttribute = domainAttribute {
      attributes.append("Domain=\(domainAttribute)")
    }
    let header = "\(staffCookieName)=\(syntheticCookieValue); " + attributes.joined(separator: "; ")
    return HTTPCookie.cookies(withResponseHeaderFields: ["Set-Cookie": header], for: staffCookieUrl).first
  }

  // بندوّر بالاسم والقيمة بس: التنظيف اللي قبل كل حالة بيخلّي المخزن فيه كوكي واحد بس.
  private func staffCookieInSharedStorage() -> HTTPCookie? {
    HTTPCookieStorage.shared.cookies(for: staffCookieUrl)?.first { cookie in
      cookie.name == staffCookieName && cookie.value == syntheticCookieValue
    }
  }

  private func assertStaffCookieInSharedStorage(_ cookie: HTTPCookie, domain: String) {
    HTTPCookieStorage.shared.setCookie(cookie)
    guard let stored = staffCookieInSharedStorage() else {
      XCTFail("The staff cookie should be readable from HTTPCookieStorage.shared for \(domain)")
      return
    }
    XCTAssertTrue(stored.isHTTPOnly, "The staff cookie should stay HttpOnly in HTTPCookieStorage.shared")
    XCTAssertTrue(stored.isSecure, "The staff cookie should stay Secure in HTTPCookieStorage.shared")
    XCTAssertEqual(stored.path, "/v1", "The staff cookie should keep its path")
    XCTAssertEqual(stored.domain, domain, "The staff cookie should keep its domain")
    XCTAssertNotNil(stored.expiresDate, "The staff cookie should keep its expiry")
  }

  // جولة WebKit: بنحط الكوكي في مخزن WebKit، بنقراه من هناك، وبنرجّعه للمخزن الأصلي.
  // لو HttpOnly ضاع في الرحلة دي، الخزنة هتفشل التحقق وتمسح الجلسة.
  private func assertStaffCookieSurvivesWebKitSync(_ cookie: HTTPCookie, domain: String) {
    let store = WKWebsiteDataStore.default().httpCookieStore
    let synced = expectation(description: "the staff cookie round-trips through the WebKit store")
    store.setCookie(cookie) {
      store.getAllCookies { cookies in
        guard let webKitCookie = cookies.first(where: {
          $0.name == self.staffCookieName && $0.value == self.syntheticCookieValue
        }) else {
          XCTFail("The WebKit store should return the staff cookie")
          synced.fulfill()
          return
        }
        XCTAssertTrue(webKitCookie.isHTTPOnly, "The staff cookie should stay HttpOnly in the WebKit store")
        XCTAssertNotNil(webKitCookie.expiresDate, "The staff cookie should keep its expiry in the WebKit store")
        // ملاحظة Opus N-4: المرور من WebKit ممكن يغيّر الدومين أو المسار، ولازم
        // نتأكد إن الكوكي رجع بنفس الدومين المتوقّع ونفس المسار /v1.
        XCTAssertEqual(webKitCookie.domain, domain, "The staff cookie should keep its domain in the WebKit store")
        XCTAssertEqual(webKitCookie.path, "/v1", "The staff cookie should keep its path in the WebKit store")
        HTTPCookieStorage.shared.setCookie(webKitCookie)
        let restored = self.staffCookieInSharedStorage()
        XCTAssertNotNil(restored, "The staff cookie should be readable after the WebKit sync")
        XCTAssertTrue(
          restored?.isHTTPOnly == true,
          "The staff cookie should stay HttpOnly after the WebKit sync"
        )
        XCTAssertNotNil(
          restored?.expiresDate,
          "The staff cookie should keep its expiry after the WebKit sync"
        )
        XCTAssertEqual(restored?.domain, domain, "The staff cookie should keep its domain after the WebKit sync")
        XCTAssertEqual(restored?.path, "/v1", "The staff cookie should keep its path after the WebKit sync")
        synced.fulfill()
      }
    }
    wait(for: [synced], timeout: 20)
  }

  // تنظيف الكوكي الصناعي من المخزن الأصلي ومن مخزن WebKit، عشان ما يلوّثش
  // أي اختبار تاني على نفس المحاكي. بنستنى حذف WebKit يخلص، عشان الحالة الجاية
  // ما تلاقي كوكي الحالة اللي قبلها بنفس الاسم والقيمة.
  private func removeSyntheticStaffCookies() {
    for cookie in HTTPCookieStorage.shared.cookies ?? [] where cookie.name == staffCookieName {
      HTTPCookieStorage.shared.deleteCookie(cookie)
    }
    let store = WKWebsiteDataStore.default().httpCookieStore
    let removed = expectation(description: "the synthetic staff cookie is removed from the WebKit store")
    store.getAllCookies { cookies in
      let pending = cookies.filter { $0.name == self.staffCookieName }
      self.deleteWebKitCookies(pending, from: 0) {
        removed.fulfill()
      }
    }
    wait(for: [removed], timeout: 20)
  }

  private func deleteWebKitCookies(_ cookies: [HTTPCookie], from index: Int, done: @escaping () -> Void) {
    guard index < cookies.count else {
      done()
      return
    }
    WKWebsiteDataStore.default().httpCookieStore.delete(cookies[index]) {
      self.deleteWebKitCookies(cookies, from: index + 1, done: done)
    }
  }
}
