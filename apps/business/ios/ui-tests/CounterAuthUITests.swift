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
    app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch
  }

  // The buttons are looked up by their exact label: a "contains" match hits the heading
  // «Pair this device» or the field «Pairing code» before it reaches the button itself.
  private func button(_ app: XCUIApplication, _ label: String) -> XCUIElement {
    let predicate = NSPredicate(format: "label == %@", label)
    let webButton = app.webViews.buttons.matching(predicate).firstMatch
    return webButton.exists ? webButton : app.buttons.matching(predicate).firstMatch
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

  // The keyboard can cover a button after typing, so the button stays not hittable until the
  // keyboard goes. XCUITest scrolls the element into view itself, so waiting for its existence
  // is enough and the hittable gate would only fail on a covered button.
  private func tapButton(_ app: XCUIApplication, _ label: String, _ message: String) {
    let target = button(app, label)
    XCTAssertTrue(target.waitForExistence(timeout: 60), message)
    target.tap()
  }

  // The software keyboard may stay up after typing and cover the next button. The Return key
  // of the keyboard submits the form, so the heading of the page is tapped instead: it is text
  // and not a control, so it only hides the keyboard and sends nothing.
  private func dismissKeyboard(_ app: XCUIApplication, under heading: String) {
    guard app.keyboards.count > 0 else { return }
    let title = app.webViews.staticTexts[heading]
    if title.exists {
      title.tap()
      return
    }
    let page = app.webViews.firstMatch
    guard page.exists else { return }
    page.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.04)).tap()
  }

  private func type(_ value: String, into field: XCUIElement, _ message: String) {
    XCTAssertTrue(field.waitForExistence(timeout: 60), message)
    assertHittable(field, message)
    field.tap()
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

    // The start screen is the native shell: waiting for its heading makes sure the web view
    // has rendered before the first button is looked up.
    assertVisible(app, "How do you use this device?", timeout: 60, "The start screen should be visible")
    tapButton(app, "Counter device", "The counter-device choice should be tappable")
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
    dismissKeyboard(app, under: "Pair this device")
    tapButton(app, "Pair", "The pairing button should be tappable")
    assertVisible(app, "Waiting for approval", timeout: 60, "The approval wait should be visible")

    assertVisible(app, "Staff sign-in", timeout: 180, "Staff sign-in should follow device approval")

    app.terminate()
    app = launchApp()
    assertVisible(app, "Staff sign-in", timeout: 60, "Staff sign-in should survive the restart")
    XCTAssertFalse(element(app, labelled: "Pair this device").exists, "Pairing should not restart")

    tapButton(app, "Use my cashier PIN", "The PIN choice should be tappable")
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
    dismissKeyboard(app, under: "Staff sign-in")
    tapButton(app, "Sign in with my PIN", "The PIN sign-in button should be tappable")
    assertVisible(app, "Staff signed in", timeout: 60, "Staff sign-in should succeed")

    app.terminate()
    app = launchApp()
    assertVisible(app, "Staff signed in", timeout: 60, "The staff session should survive the restart")

    tapButton(app, "Sign out", "The sign-out button should be tappable")
    assertVisible(app, "Staff sign-in", timeout: 60, "Sign-out should show staff sign-in")
  }
}
