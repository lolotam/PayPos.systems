import XCTest

final class CounterAuthUITests: XCTestCase {
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

  private func element(_ app: XCUIApplication, labelled label: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
  }

  private func assertVisible(_ app: XCUIApplication, _ label: String, timeout: TimeInterval, _ message: String) {
    XCTAssertTrue(element(app, labelled: label).waitForExistence(timeout: timeout), message)
  }

  private func assertHittable(_ target: XCUIElement, _ message: String) {
    let expectation = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "isHittable == true"),
      object: target
    )
    XCTAssertEqual(XCTWaiter().wait(for: [expectation], timeout: 30), .completed, message)
  }

  private func tap(_ app: XCUIApplication, _ label: String, _ message: String) {
    let target = element(app, labelled: label)
    XCTAssertTrue(target.waitForExistence(timeout: 60), message)
    assertHittable(target, message)
    target.tap()
  }

  private func type(_ value: String, into field: XCUIElement, _ message: String) {
    XCTAssertTrue(field.waitForExistence(timeout: 60), message)
    assertHittable(field, message)
    field.typeText(value)
  }

  private func environment() -> [String: String]? {
    let values = ProcessInfo.processInfo.environment
    let keys = ["SPIKE_PAIRING_CODE", "SPIKE_DEVICE_LABEL", "SPIKE_STAFF_PHONE", "SPIKE_STAFF_PIN"]
    guard keys.allSatisfy({ values[$0]?.isEmpty == false }) else {
      XCTFail("The counter auth test environment is incomplete")
      return nil
    }
    return Dictionary(uniqueKeysWithValues: keys.map { ($0, values[$0]!) })
  }

  func testCounterPairingAndStaffPin() {
    guard let values = environment() else { return }
    var app = launchApp()

    tap(app, "Counter device", "The counter-device choice should be tappable")
    type(
      values["SPIKE_PAIRING_CODE"]!,
      into: app.webViews.textFields["Pairing code"],
      "The pairing-code field should be ready"
    )
    type(
      values["SPIKE_DEVICE_LABEL"]!,
      into: app.webViews.textFields["Device name"],
      "The device-name field should be ready"
    )
    tap(app, "Pair", "The pairing button should be tappable")
    assertVisible(app, "Waiting for approval", timeout: 60, "The approval wait should be visible")

    assertVisible(app, "Staff sign-in", timeout: 180, "Staff sign-in should follow device approval")

    app.terminate()
    app = launchApp()
    assertVisible(app, "Staff sign-in", timeout: 60, "Staff sign-in should survive the restart")
    XCTAssertFalse(element(app, labelled: "Pair this device").exists, "Pairing should not restart")

    tap(app, "Use my cashier PIN", "The PIN choice should be tappable")
    type(
      values["SPIKE_STAFF_PHONE"]!,
      into: app.webViews.textFields["International phone number"],
      "The phone field should be ready"
    )
    type(
      values["SPIKE_STAFF_PIN"]!,
      into: app.webViews.secureTextFields["Your own four-digit cashier PIN"],
      "The PIN field should be ready"
    )
    tap(app, "Sign in with my PIN", "The PIN sign-in button should be tappable")
    assertVisible(app, "Staff signed in", timeout: 60, "Staff sign-in should succeed")

    app.terminate()
    app = launchApp()
    assertVisible(app, "Staff signed in", timeout: 60, "The staff session should survive the restart")

    tap(app, "Sign out", "The sign-out button should be tappable")
    assertVisible(app, "Staff sign-in", timeout: 60, "Sign-out should show staff sign-in")
  }
}
