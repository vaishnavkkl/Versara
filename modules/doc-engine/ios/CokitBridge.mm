#import "CokitBridge.h"
#import "CokitSession.h"
#include <algorithm>
#include <vector>

@implementation CokitBridge {
  VersaraCokitSession *_session;
}

+ (BOOL)isAvailable {
  return versara_cokit_available() != 0;
}

- (BOOL)openPath:(NSString *)path error:(NSError **)error {
  [self close];
  if (![CokitBridge isAvailable]) {
    if (error) *error = [NSError errorWithDomain:@"VersaraCokit" code:1
      userInfo:@{NSLocalizedDescriptionKey: @"The offline document engine is not bundled in this build."}];
    return NO;
  }
  NSString *install = NSBundle.mainBundle.bundlePath;
  NSString *profilePath = [NSTemporaryDirectory() stringByAppendingPathComponent:@"versara-cokit-profile"];
  [[NSFileManager defaultManager] createDirectoryAtPath:profilePath
                            withIntermediateDirectories:YES attributes:nil error:nil];
  NSURL *profile = [NSURL fileURLWithPath:profilePath isDirectory:YES];
  NSURL *input = [NSURL fileURLWithPath:path];
  char message[1024] = {};
  _session = versara_cokit_open(install.UTF8String, profile.absoluteString.UTF8String,
                                input.absoluteString.UTF8String, message, sizeof(message));
  if (!_session && error) *error = [NSError errorWithDomain:@"VersaraCokit" code:2
    userInfo:@{NSLocalizedDescriptionKey:
      [NSString stringWithUTF8String:message[0] ? message : "Document open failed."]}];
  return _session != nullptr;
}

- (CGSize)documentSizeTwips {
  int width = 0, height = 0;
  if (!_session || !versara_cokit_size(_session, &width, &height)) return CGSizeZero;
  return CGSizeMake(width, height);
}

- (NSString *)pageRectangles {
  if (!_session) return @"";
  const size_t needed = versara_cokit_page_rectangles(_session, nullptr, 0);
  if (!needed || needed > 1024 * 1024) return @"";
  std::vector<char> value(needed);
  if (versara_cokit_page_rectangles(_session, value.data(), value.size()) > value.size()) return @"";
  return [NSString stringWithUTF8String:value.data()] ?: @"";
}

- (UIImage *)paintX:(NSInteger)x y:(NSInteger)y width:(NSInteger)width height:(NSInteger)height
         pixelsWide:(NSInteger)pixelsWide pixelsHigh:(NSInteger)pixelsHigh {
  if (!_session || pixelsWide < 1 || pixelsHigh < 1 || pixelsWide > 2048 || pixelsHigh > 2048) return nil;
  const size_t size = (size_t)pixelsWide * (size_t)pixelsHigh * 4;
  std::vector<uint8_t> pixels(size);
  int mode = 0;
  if (!versara_cokit_paint(_session, (int)x, (int)y, (int)width, (int)height,
                           (int)pixelsWide, (int)pixelsHigh, pixels.data(), pixels.size(), &mode)) return nil;
  if (mode == 1) for (size_t at = 0; at < size; at += 4) std::swap(pixels[at], pixels[at + 2]);
  NSData *data = [NSData dataWithBytes:pixels.data() length:size];
  CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)data);
  CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
  CGImageRef image = CGImageCreate((size_t)pixelsWide, (size_t)pixelsHigh, 8, 32,
                                  (size_t)pixelsWide * 4, colorSpace,
                                  kCGBitmapByteOrder32Big | kCGImageAlphaPremultipliedLast,
                                  provider, nullptr, false, kCGRenderingIntentDefault);
  UIImage *result = image ? [UIImage imageWithCGImage:image] : nil;
  if (image) CGImageRelease(image);
  CGColorSpaceRelease(colorSpace);
  CGDataProviderRelease(provider);
  return result;
}

- (BOOL)postCommand:(NSString *)command arguments:(NSString *)arguments {
  return _session && versara_cokit_uno(_session, command.UTF8String, arguments.UTF8String);
}

- (BOOL)postKeyType:(NSInteger)type character:(NSInteger)character keyCode:(NSInteger)keyCode {
  return _session && versara_cokit_key(_session, (int)type, (int)character, (int)keyCode);
}

- (BOOL)postMouseType:(NSInteger)type x:(NSInteger)x y:(NSInteger)y clicks:(NSInteger)clicks
               buttons:(NSInteger)buttons modifiers:(NSInteger)modifiers {
  return _session && versara_cokit_mouse(_session, (int)type, (int)x, (int)y, (int)clicks,
                                         (int)buttons, (int)modifiers);
}

- (BOOL)savePath:(NSString *)path format:(NSString *)format {
  if (!_session) return NO;
  NSURL *url = [NSURL fileURLWithPath:path];
  return versara_cokit_save(_session, url.absoluteString.UTF8String, format.UTF8String);
}

- (NSDictionary<NSString *, id> *)nextEvent {
  if (!_session) return nil;
  int type = 0;
  const size_t needed = versara_cokit_next_event(_session, &type, nullptr, 0);
  if (!needed || needed > 64 * 1024 + 1) return nil;
  std::vector<char> payload(needed);
  if (versara_cokit_next_event(_session, &type, payload.data(), payload.size()) > payload.size()) return nil;
  return @{ @"type": @(type), @"payload": [NSString stringWithUTF8String:payload.data()] ?: @"" };
}

- (void)close {
  if (_session) versara_cokit_close(_session);
  _session = nullptr;
}

- (void)dealloc { [self close]; }

@end
