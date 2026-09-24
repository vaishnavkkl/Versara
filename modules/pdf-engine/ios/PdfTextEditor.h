#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
@interface PdfTextEditor : NSObject
- (void)run:(NSString *)identifier request:(NSString *)request
   progress:(void (^)(NSInteger, NSInteger))progress
 completion:(void (^)(NSString * _Nullable, NSString * _Nullable, NSString * _Nullable))completion;
- (void)cancel:(NSString *)identifier;
- (void)destroy;
@end
NS_ASSUME_NONNULL_END
