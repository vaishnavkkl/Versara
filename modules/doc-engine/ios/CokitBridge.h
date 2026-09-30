#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface CokitBridge : NSObject
+ (BOOL)isAvailable;
- (BOOL)openPath:(NSString *)path error:(NSError * _Nullable * _Nullable)error;
- (CGSize)documentSizeTwips;
- (NSString *)pageRectangles;
- (nullable UIImage *)paintX:(NSInteger)x y:(NSInteger)y width:(NSInteger)width height:(NSInteger)height
                      pixelsWide:(NSInteger)pixelsWide pixelsHigh:(NSInteger)pixelsHigh;
- (BOOL)postCommand:(NSString *)command arguments:(NSString *)arguments;
- (BOOL)postKeyType:(NSInteger)type character:(NSInteger)character keyCode:(NSInteger)keyCode;
- (BOOL)postMouseType:(NSInteger)type x:(NSInteger)x y:(NSInteger)y clicks:(NSInteger)clicks
                  buttons:(NSInteger)buttons modifiers:(NSInteger)modifiers;
- (BOOL)savePath:(NSString *)path format:(NSString *)format;
- (nullable NSDictionary<NSString *, id> *)nextEvent;
- (void)close;
@end

NS_ASSUME_NONNULL_END
