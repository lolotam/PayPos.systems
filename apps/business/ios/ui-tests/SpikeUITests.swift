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

  // الترتيب مهم لأن اختبار الرجوع بعد الإغلاق بيسيب اختيار الموظفة محفوظ، فشاشة البداية لازم تتختبر الأول.
  func test1StartScreenShowsBothChoices() {
    let app = launchApp()

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
  }

  func test2EmployeeChoiceSurvivesRestart() {
    var app = launchApp()

    if element(app, containing: "How do you use this device?").waitForExistence(timeout: 60) {
      let employeeChoice = element(app, containing: "My employee account")
      XCTAssertTrue(
        employeeChoice.waitForExistence(timeout: 60),
        "The employee-account choice should be visible before it is tapped"
      )
      employeeChoice.tap()
    }
    XCTAssertTrue(
      element(app, containing: "Paste the link your manager sent you").waitForExistence(timeout: 60),
      "The employee paste field should be visible after choosing the employee flow"
    )

    app.terminate()
    app = launchApp()

    XCTAssertTrue(
      element(app, containing: "Paste the link your manager sent you").waitForExistence(timeout: 60),
      "The employee paste field should still be visible after an app restart"
    )
    XCTAssertFalse(
      element(app, containing: "How do you use this device?").exists,
      "The start screen should not return after the employee choice was saved"
    )
  }
}
