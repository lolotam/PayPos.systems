import XCTest

// البيئة التجريبية بس: الاختبار بيشغّل التطبيق المتثبّت على المحاكي بالـ bundle id بتاعه، ومش بيبنيه
// (spec 065، صف M-1c). اللغة إنجليزي عشان النصوص تبقى ثابتة مهما كانت لغة المحاكي.
final class SpikeUITests: XCTestCase {
  private let bundleId = "systems.pospay.business.staging"

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
}
