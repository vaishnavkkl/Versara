import Foundation

enum PdfIntegrity {
  private struct Failure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
  }
  /// PDFium sees certificate signatures even when they have no visible widget.
  /// All callers use their existing native worker and validate local cache URLs.
  static func requireUnsigned(_ source: URL, password: String = "") throws {
    let raw = PdfTextEditor.inspect(source.path, password: password)
    guard let data = raw.data(using: .utf8), let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw Failure(message: "Could not inspect this PDF safely.")
    }
    if let error = result["error"] as? String { throw Failure(message: error) }
    guard let signatures = result["signatureCount"] as? Int, signatures == 0 else {
      throw Failure(message: "This PDF is digitally signed. Use an unsigned copy to preserve its signatures.")
    }
  }
}
