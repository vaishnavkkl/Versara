import Foundation
import UIKit
import ImageIO
import UniformTypeIdentifiers

/// Transparent signature PNG plus bounded BGRA pixels for the shared PDF engine.
enum SignatureImage {
  private static func fail(_ message: String) -> NSError { NSError(domain: "SignatureImage", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
  static func process(_ r: [String: Any], check: () throws -> Void) throws -> [String: Any] {
    func local(_ value: String) throws -> URL {
      guard let url = URL(string: value), url.isFileURL else { throw fail("Choose a local signature image.") }
      let result = url.resolvingSymlinksInPath().standardizedFileURL
      let roots = [FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0], FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]]
      guard roots.contains(where: { result.path.hasPrefix($0.resolvingSymlinksInPath().path + "/") }) else { throw fail("Choose the image again.") }
      return result
    }
    let input = try local(r["uri"] as? String ?? ""), output = try local(r["outputUri"] as? String ?? "")
    let raw = URL(fileURLWithPath: output.path + ".bgra"), temp = URL(fileURLWithPath: output.path + ".partial")
    guard ![output,raw,temp].contains(where: { FileManager.default.fileExists(atPath: $0.path) }) else { throw fail("Choose a new signature asset name.") }
    var committed = false
    defer { try? FileManager.default.removeItem(at: temp); if !committed { try? FileManager.default.removeItem(at: output); try? FileManager.default.removeItem(at: raw) } }
    try check()
    guard let image = ImageEditing.load(uri: input.absoluteString, maxPixels: 1024) else { throw fail("Could not read the signature image.") }
    let w = image.width, h = image.height
    guard (1...1024).contains(w), (1...1024).contains(h), let space = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w*4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { throw fail("Could not prepare signature memory.") }
    context.draw(image, in: CGRect(x: 0,y: 0,width: w,height: h))
    guard let pixels = context.data?.assumingMemoryBound(to: UInt8.self) else { throw fail("Could not prepare signature pixels.") }
    var data = Data(); var width = UInt32(w).bigEndian, height = UInt32(h).bigEndian
    withUnsafeBytes(of: &width) { data.append(contentsOf: $0) }; withUnsafeBytes(of: &height) { data.append(contentsOf: $0) }
    data.reserveCapacity(8+w*h*4)
    let remove = r["removeBackground"] as? Bool ?? false
    for y in 0..<h {
      try check()
      for x in 0..<w {
        let i = (y*w+x)*4, a = Double(pixels[i+3])
        var red = a > 0 ? min(255,Double(pixels[i])*255/a) : 0
        var green = a > 0 ? min(255,Double(pixels[i+1])*255/a) : 0
        var blue = a > 0 ? min(255,Double(pixels[i+2])*255/a) : 0
        let coverage = remove ? min(1,max(0,(0.94-min(red,min(green,blue))/255)/0.30)) : 1
        let alpha = Int((a*coverage).rounded())
        if remove && coverage > 0 {
          red=min(255,max(0,(red-255*(1-coverage))/coverage))
          green=min(255,max(0,(green-255*(1-coverage))/coverage))
          blue=min(255,max(0,(blue-255*(1-coverage))/coverage))
        }
        if alpha == 0 { red=0; green=0; blue=0 }
        data.append(UInt8(blue.rounded())); data.append(UInt8(green.rounded())); data.append(UInt8(red.rounded())); data.append(UInt8(alpha))
        pixels[i]=UInt8((red*Double(alpha)/255).rounded()); pixels[i+1]=UInt8((green*Double(alpha)/255).rounded())
        pixels[i+2]=UInt8((blue*Double(alpha)/255).rounded()); pixels[i+3]=UInt8(alpha)
      }
    }
    try check(); try data.write(to: raw)
    guard let rendered = context.makeImage(), let destination = CGImageDestinationCreateWithURL(temp as CFURL, UTType.png.identifier as CFString, 1, nil) else { throw fail("Could not encode the signature.") }
    CGImageDestinationAddImage(destination,rendered,nil)
    guard CGImageDestinationFinalize(destination) else { throw fail("Could not encode the signature.") }
    try check(); try FileManager.default.moveItem(at: temp,to: output); try check(); committed=true
    return ["uri": output.absoluteString, "pixelPath": raw.path, "width": w,"height": h,"mimeType": "image/png","size": (try output.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0]
  }
}
