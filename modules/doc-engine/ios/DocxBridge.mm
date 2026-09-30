#import "DocxBridge.h"
#include "DocxCore.hpp"

@implementation DocxBridge
+ (NSString *)run:(NSString *)request {
  std::string input = request.UTF8String ? request.UTF8String : "";
  auto output = versara::runDoc(input);
  return [[NSString alloc] initWithBytes:output.data() length:output.size() encoding:NSUTF8StringEncoding]
    ?: @"{\"error\":\"DOC_OPEN\",\"message\":\"Could not read the document result.\"}";
}
@end
