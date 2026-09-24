#import "PdfTextEditor.h"
#include "../cpp/TextEditor.hpp"

@implementation PdfTextEditor {
  dispatch_queue_t _worker;
  NSMutableSet<NSString *> *_cancelled;
  NSMutableSet<NSString *> *_active;
  BOOL _destroyed;
}
- (instancetype)init {
  if ((self = [super init])) {
    _worker = dispatch_queue_create("com.versara.pdf.text", DISPATCH_QUEUE_SERIAL);
    _cancelled = [NSMutableSet new];
    _active = [NSMutableSet new];
  }
  return self;
}
- (void)cancel:(NSString *)identifier { @synchronized(self) {
  if (_destroyed) return;
  if (_cancelled.count >= 64) {
    for (NSString *stale in [_cancelled allObjects]) {
      if (![_active containsObject:stale]) { [_cancelled removeObject:stale]; break; }
    }
  }
  [_cancelled addObject:identifier];
} }
- (void)destroy { @synchronized(self) { _destroyed = YES; [_cancelled removeAllObjects]; } }
- (BOOL)stopped:(NSString *)identifier { @synchronized(self) { return _destroyed || [_cancelled containsObject:identifier]; } }
- (void)run:(NSString *)identifier request:(NSString *)request
   progress:(void (^)(NSInteger, NSInteger))progress
 completion:(void (^)(NSString *, NSString *, NSString *))completion {
  @synchronized(self) {
    if (_destroyed || _active.count >= 4 || [_active containsObject:identifier]) {
      completion(nil, @"PDF_BUSY", @"Another PDF task is finishing or this tool has closed. Please try again.");
      return;
    }
    [_active addObject:identifier];
  }
  dispatch_async(_worker, ^{
    @autoreleasepool {
      NSMutableDictionary *options = [NSJSONSerialization JSONObjectWithData:[request dataUsingEncoding:NSUTF8StringEncoding] options:NSJSONReadingMutableContainers error:nil];
      if (![options isKindOfClass:NSMutableDictionary.class]) {
        completion(nil, @"PDF_INVALID_OPTIONS", @"Invalid editor request.");
        @synchronized(self) { [self->_cancelled removeObject:identifier]; [self->_active removeObject:identifier]; }
        return;
      }
      NSURL *source = [options[@"uri"] isKindOfClass:NSString.class] ? [NSURL URLWithString:options[@"uri"]] : nil;
      BOOL preview = [options[@"action"] isEqual:@"preview"];
      NSString *outputKey = preview ? @"imageUri" : @"outputUri";
      NSURL *output = [options[outputKey] isKindOfClass:NSString.class] ? [NSURL URLWithString:options[outputKey]] : nil;
      if (![options isKindOfClass:NSMutableDictionary.class] || !source.isFileURL || !output.isFileURL) {
        completion(nil, @"PDF_INVALID_PATH", @"Choose a local PDF and try again.");
      } else {
        options[@"path"] = source.path;
        options[preview ? @"imagePath" : @"outputPath"] = output.path;
        NSString *input = [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:options options:0 error:nil] encoding:NSUTF8StringEncoding];
        NSString *cache = [NSFileManager.defaultManager URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject.path;
        NSString *documents = [NSFileManager.defaultManager URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject.path;
        auto result = versara::runEditor(input.UTF8String, cache.UTF8String, documents.UTF8String,
          [self, identifier] { return bool([self stopped:identifier]); },
          [progress](int completed, int total) { progress(completed, total); });
        NSData *data = [NSData dataWithBytes:result.data() length:result.size()];
        NSMutableDictionary *response = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:nil];
        if (response[@"error"]) completion(nil, response[@"code"], response[@"error"]);
        else {
          response[preview ? @"imageUri" : @"uri"] = options[outputKey];
          NSString *json = [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:response options:0 error:nil] encoding:NSUTF8StringEncoding];
          completion(json, nil, nil);
        }
      }
      @synchronized(self) { [self->_cancelled removeObject:identifier]; [self->_active removeObject:identifier]; }
    }
  });
}
@end
