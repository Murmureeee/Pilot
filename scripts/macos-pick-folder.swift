import AppKit
import ApplicationServices
import CoreGraphics

let escape: CGKeyCode = 53
let returnKey: CGKeyCode = 36
let gKey: CGKeyCode = 5
let vKey: CGKeyCode = 9

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func attribute<T>(_ element: AXUIElement, _ name: String) -> T? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
        return nil
    }
    return value as? T
}

guard (2...3).contains(CommandLine.arguments.count), let pid = pid_t(CommandLine.arguments[1]) else {
    fail("Expected the test Pilot process ID and an optional folder")
}
guard AXIsProcessTrusted(), CGPreflightPostEventAccess() else {
    fail("The native picker test requires Accessibility and Quartz input access")
}

let app = AXUIElementCreateApplication(pid)
let title = "Choose the tools’ working directory"
func pickerIsVisible() -> Bool {
    let windows: [AXUIElement] = attribute(app, kAXWindowsAttribute) ?? []
    return windows.contains { (attribute($0, kAXTitleAttribute) as String?) == title }
}

func sendKey(_ code: CGKeyCode, _ flags: CGEventFlags = []) {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
        fail("Pilot must be the frontmost application before sending native input")
    }
    for down in [true, false] {
        guard let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down) else {
            fail("Could not create a native key event")
        }
        event.flags = flags
        event.post(tap: .cghidEventTap)
    }
}

let deadline = Date().addingTimeInterval(8)
while !pickerIsVisible() {
    guard Date() < deadline else { fail("The native Pilot directory picker did not open") }
    Thread.sleep(forTimeInterval: 0.1)
}

if CommandLine.arguments.count == 2 {
    sendKey(escape)
} else {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    guard pasteboard.setString(CommandLine.arguments[2], forType: .string) else {
        fail("Could not copy the fixture folder")
    }
    defer { pasteboard.clearContents() }

    // The Go to Folder panel opens, resolves its suggestion, then hands focus back to the picker.
    sendKey(gKey, [.maskCommand, .maskShift])
    Thread.sleep(forTimeInterval: 0.5)
    sendKey(vKey, .maskCommand)
    Thread.sleep(forTimeInterval: 0.7)
    sendKey(returnKey)
    Thread.sleep(forTimeInterval: 0.5)
    sendKey(returnKey)
}
