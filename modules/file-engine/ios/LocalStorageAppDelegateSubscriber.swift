import ExpoModulesCore
import Foundation
import UIKit

/** Exclude original imports, outputs, drafts, SQLite and preferences from OS backups. */
public final class LocalStorageAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    applyExclusions()
    return false
  }

  public func applicationDidBecomeActive(_ application: UIApplication) {
    applyExclusions()
  }

  private func applyExclusions() {
    guard Bundle.main.object(forInfoDictionaryKey: "VersaraExcludeAppDataFromBackup") as? Bool == true else { return }
    for directory in [FileManager.SearchPathDirectory.documentDirectory, .libraryDirectory] {
      guard var url = FileManager.default.urls(for: directory, in: .userDomainMask).first else { continue }
      do {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
      } catch {
        NSLog("Versara could not apply its local-storage backup policy: %@", error.localizedDescription)
      }
    }
  }
}
