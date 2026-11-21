#import <ARKit/ARKit.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreImage/CoreImage.h>
#import <ImageIO/ImageIO.h>
#import <QuartzCore/QuartzCore.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTInvalidating.h>
#import <UIKit/UIKit.h>
#import <WebRTC/WebRTC.h>
#import <WebRTC/RTCCVPixelBuffer.h>
#if __has_include(<react-native-webrtc/WebRTCModule+RTCMediaStream.h>)
#import <react-native-webrtc/TrackCapturerEventsEmitter.h>
#import <react-native-webrtc/WebRTCModule+RTCMediaStream.h>
#else
// CocoaPods sanitizes the product name when the app uses frameworks.
#import <react_native_webrtc/TrackCapturerEventsEmitter.h>
#import <react_native_webrtc/WebRTCModule+RTCMediaStream.h>
#endif
#include "DepthSamples.hpp"

// This is the WebRTC video track's capture controller. ARKit owns the rear camera
// throughout its lifetime. Preview and WHIP both consume the ARFrame color image.
@interface AetherLiDARCapture : CaptureController <ARSessionDelegate>
@property (nonatomic, copy) void (^startup)(BOOL);
@property (atomic, copy) NSDictionary *sample;
- (instancetype)initWithSource:(RTCVideoSource *)source queue:(dispatch_queue_t)queue;
- (void)abandon;
- (void)requestSnapshot:(RCTPromiseResolveBlock)resolve started:(NSTimeInterval)start;
@end

@implementation AetherLiDARCapture {
    RTCVideoSource *_source;
    RTCVideoCapturer *_capturer;
    dispatch_queue_t _queue;
    ARSession *_session;
    NSTimeInterval _lastColor, _lastDepth;
    CGSize _resolution;
    BOOL _retired;
    RCTPromiseResolveBlock _snapshot;
    NSTimeInterval _snapshotStart, _snapshotDeadline;
    NSUInteger _snapshotId;
    BOOL _encoding;
}

- (instancetype)initWithSource:(RTCVideoSource *)source queue:(dispatch_queue_t)queue {
    if ((self = [super init])) {
        _source = source;
        _capturer = [[RTCVideoCapturer alloc] initWithDelegate:source];
        _queue = queue;
        [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(background:)
            name:UIApplicationDidEnterBackgroundNotification object:nil];
    }
    return self;
}

- (void)dealloc { [[NSNotificationCenter defaultCenter] removeObserver:self]; [_session pause]; }

- (void)background:(NSNotification *)note {
    dispatch_async(_queue, ^{ [self abandon]; });
}

- (void)startCapture {
    if (_session || _retired) return;
    ARWorldTrackingConfiguration *config = [ARWorldTrackingConfiguration new];
    config.worldAlignment = ARWorldAlignmentGravity;
    config.frameSemantics = ARFrameSemanticSceneDepth;
    _resolution = config.videoFormat.imageResolution;
    _session = [ARSession new];
    _session.delegateQueue = _queue;
    _session.delegate = self;
    _lastColor = _lastDepth = 0;
    [_session runWithConfiguration:config];
}

- (void)stopCapture {
    self.sample = nil;
    [self finishSnapshot:nil];
    _session.delegate = nil;
    [_session pause];
    _session = nil;
    void (^startup)(BOOL) = self.startup;
    self.startup = nil;
    if (startup) startup(NO);
}

- (void)finishSnapshot:(NSDictionary *)value {
    RCTPromiseResolveBlock resolve = _snapshot;
    _snapshot = nil;
    if (resolve) {
        if (value) resolve(value);
        else resolve(NSNull.null);
    }
}

// Only an explicit question arms a snapshot. Never hold an ARFrame while
// encoding: the independent color CIImage owns just its source pixel buffer.
- (void)requestSnapshot:(RCTPromiseResolveBlock)resolve started:(NSTimeInterval)start {
    const NSTimeInterval remaining = start + 1.2 - CACurrentMediaTime();
    if (!_session || _retired || _snapshot || _encoding || remaining <= 0) {
        resolve(NSNull.null);
        return;
    }
    _snapshot = [resolve copy];
    _snapshotStart = start;
    _snapshotDeadline = start + 1.2;
    const NSUInteger request = ++_snapshotId;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(remaining * NSEC_PER_SEC)), _queue, ^{
        if (request == self->_snapshotId) [self finishSnapshot:nil];
    });
}

- (void)encodeFrame:(ARFrame *)frame center:(float)meters timestamp:(NSNumber *)timestamp {
    _encoding = YES;
    const NSUInteger request = _snapshotId;
    CIImage *color = [CIImage imageWithCVPixelBuffer:frame.capturedImage];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        @autoreleasepool {
            static CIContext *context;
            static dispatch_once_t once;
            dispatch_once(&once, ^{ context = [CIContext contextWithOptions:@{kCIContextCacheIntermediates: @NO}]; });
            // Rotate the pixels themselves; the answer provider needn't interpret EXIF.
            CIImage *portrait = [color imageByApplyingCGOrientation:kCGImagePropertyOrientationRight];
            const CGFloat longest = MAX(portrait.extent.size.width, portrait.extent.size.height);
            NSData *bytes = nil;
            if (longest > 0) {
                const CGFloat scale = MIN(1., 480. / longest);
                CIImage *small = [portrait imageByApplyingTransform:CGAffineTransformMakeScale(scale, scale)];
                CGRect bounds = small.extent;
                bounds.size.width = floor(bounds.size.width);
                bounds.size.height = floor(bounds.size.height);
                CGImageRef bitmap = [context createCGImage:small fromRect:bounds];
                if (bitmap) {
                    bytes = UIImageJPEGRepresentation([UIImage imageWithCGImage:bitmap], .65);
                    CGImageRelease(bitmap);
                }
            }
            NSString *jpeg = [bytes base64EncodedStringWithOptions:0];
            dispatch_async(self->_queue, ^{
                self->_encoding = NO;
                if (self->_snapshot && request == self->_snapshotId) {
                    NSDictionary *result = nil;
                    if (jpeg.length && CACurrentMediaTime() < self->_snapshotDeadline) {
                        result = @{@"jpeg": jpeg, @"centerM": @(meters), @"timestampMs": timestamp};
                    }
                    [self finishSnapshot:result];
                }
            });
        }
    });
}

- (void)abandon {
    if (_retired) return;
    _retired = YES;
    BOOL opened = self.startup == nil && _session != nil;
    [self stopCapture];
    if (opened) [self.eventsDelegate capturerDidEnd:_capturer];
}

- (NSDictionary *)getSettings {
    return @{@"width": @((int)_resolution.width), @"height": @((int)_resolution.height),
             @"frameRate": @15, @"facingMode": @"environment", @"deviceId": @"aether-arkit-rear"};
}

- (void)sessionWasInterrupted:(ARSession *)session {
    if (session == _session) [self abandon];
}

- (void)session:(ARSession *)session didFailWithError:(NSError *)error {
    if (session == _session) [self abandon];
}

- (void)session:(ARSession *)session didUpdateFrame:(ARFrame *)frame {
    if (session != _session) return; // delegate callbacks from a released track
    if (frame.timestamp - _lastColor >= 1.0/15.0 - .002) {
        _lastColor = frame.timestamp;
        RTCCVPixelBuffer *buffer = [[RTCCVPixelBuffer alloc] initWithPixelBuffer:frame.capturedImage];
        // App orientation is locked to portrait, rear camera sensor delivers landscape frames.
        RTCVideoFrame *video = [[RTCVideoFrame alloc] initWithBuffer:buffer rotation:RTCVideoRotation_90
                                                        timeStampNs:(int64_t)(frame.timestamp * 1e9)];
        [_source capturer:_capturer didCaptureVideoFrame:video];
        void (^startup)(BOOL) = self.startup;
        self.startup = nil;
        if (startup) startup(YES);
    }
    if (frame.camera.trackingState != ARTrackingStateNormal) {
        self.sample = nil;
        return;
    }
    if (frame.timestamp - _lastDepth < .10) return;
    _lastDepth = frame.timestamp;
    [self updateDepth:frame];
}

- (void)updateDepth:(ARFrame *)frame {
    self.sample = nil;
    const NSTimeInterval age = CACurrentMediaTime() - frame.timestamp;
    if (age < -.05 || age > .45) return;
    ARDepthData *depth = frame.sceneDepth;
    CVPixelBufferRef pixels = depth.depthMap, confidence = depth.confidenceMap;
    if (!pixels || !confidence || CVPixelBufferGetPixelFormatType(pixels) != kCVPixelFormatType_DepthFloat32 ||
        CVPixelBufferGetPixelFormatType(confidence) != kCVPixelFormatType_OneComponent8) return;
    const size_t width = CVPixelBufferGetWidth(pixels), height = CVPixelBufferGetHeight(pixels);
    if (!width || !height || width != CVPixelBufferGetWidth(confidence) ||
        height != CVPixelBufferGetHeight(confidence)) return;
    if (CVPixelBufferLockBaseAddress(pixels, kCVPixelBufferLock_ReadOnly) != kCVReturnSuccess) return;
    if (CVPixelBufferLockBaseAddress(confidence, kCVPixelBufferLock_ReadOnly) != kCVReturnSuccess) {
        CVPixelBufferUnlockBaseAddress(pixels, kCVPixelBufferLock_ReadOnly);
        return;
    }
    const matrix_float3x3 k = frame.camera.intrinsics;
    const matrix_float4x4 t = frame.camera.transform;
    const CGSize resolution = frame.camera.imageResolution;
    const float sx = width / resolution.width, sy = height / resolution.height;
    const aether::DepthMap map = {
        static_cast<const float *>(CVPixelBufferGetBaseAddress(pixels)),
        static_cast<const uint8_t *>(CVPixelBufferGetBaseAddress(confidence)), width, height,
        CVPixelBufferGetBytesPerRow(pixels)/sizeof(float), CVPixelBufferGetBytesPerRow(confidence),
        k.columns[0].x*sx, k.columns[1].y*sy, k.columns[2].x*sx, k.columns[2].y*sy,
        t.columns[0].y, t.columns[1].y, t.columns[2].y
    };
    const aether::Reading reading = aether::measure(map);
    float targetCenter = NAN;
    if (_snapshot && !_encoding && frame.timestamp >= _snapshotStart &&
        CACurrentMediaTime() < _snapshotDeadline && std::isfinite(reading.center)) {
        targetCenter = aether::patchRange(map, .5f, .5f, aether::Patch::NamedTarget);
    }
    CVPixelBufferUnlockBaseAddress(confidence, kCVPixelBufferLock_ReadOnly);
    CVPixelBufferUnlockBaseAddress(pixels, kCVPixelBufferLock_ReadOnly);
    if (!std::isfinite(reading.center) && !std::isfinite(reading.near)) return;
    const NSTimeInterval capturedAt = [NSDate date].timeIntervalSince1970 - (CACurrentMediaTime() - frame.timestamp);
    NSMutableDictionary *sample = [@{@"timestampMs": @(capturedAt * 1000)} mutableCopy];
    if (std::isfinite(reading.center)) sample[@"centerM"] = @(reading.center);
    if (std::isfinite(reading.near)) sample[@"nearM"] = @(reading.near);
    self.sample = sample;
    if (std::isfinite(targetCenter)) [self encodeFrame:frame center:targetCenter timestamp:sample[@"timestampMs"]];
}
@end

@interface AetherDepth : NSObject <RCTBridgeModule, RCTInvalidating>
@end

@implementation AetherDepth {
    __weak AetherLiDARCapture *_current;
    NSString *_streamId;
    __weak WebRTCModule *_rtc;
    BOOL _invalidated;
}
@synthesize moduleRegistry = _moduleRegistry;
RCT_EXPORT_MODULE(AetherDepth)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

// JS first requests foreground camera permission. A missing ARKit capability or
// failed startup resolves null so it can use the ordinary WebRTC camera.
RCT_EXPORT_METHOD(open:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    if (![ARWorldTrackingConfiguration isSupported] ||
        ![ARWorldTrackingConfiguration supportsFrameSemantics:ARFrameSemanticSceneDepth] ||
        [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo] != AVAuthorizationStatusAuthorized ||
        UIApplication.sharedApplication.applicationState != UIApplicationStateActive) {
        resolve(NSNull.null);
        return;
    }
    WebRTCModule *rtc = (WebRTCModule *)[self.moduleRegistry moduleForName:"WebRTCModule"];
    if (![rtc isKindOfClass:WebRTCModule.class]) { resolve(NSNull.null); return; }
    @synchronized (self) { self->_rtc = rtc; }
    dispatch_async(rtc.workerQueue, ^{
        @synchronized (self) {
            if (self->_invalidated || (self->_current && rtc.localStreams[self->_streamId])) {
                resolve(NSNull.null);
                return;
            }
        }
        __block AetherLiDARCapture *capture;
        RTCVideoTrack *track = [rtc createVideoTrackWithCaptureController:^CaptureController *(RTCVideoSource *source) {
            capture = [[AetherLiDARCapture alloc] initWithSource:source queue:rtc.workerQueue];
            return capture;
        }];
        if (!track || !capture) { resolve(NSNull.null); return; }
        NSArray *stream = [rtc createMediaStream:@[track]];
        NSString *streamId = stream.firstObject;
        capture.eventsDelegate = [[TrackCapturerEventsEmitter alloc] initWith:track.trackId webRTCModule:rtc];
        @synchronized (self) {
            if (self->_invalidated) {
                [capture stopCapture];
                [rtc.localTracks removeObjectForKey:track.trackId];
                [rtc.localStreams removeObjectForKey:streamId];
                resolve(NSNull.null);
                return;
            }
            self->_current = capture;
            self->_streamId = streamId;
        }
        capture.startup = ^(BOOL ready) {
            if (ready) {
                resolve(@{@"streamId": streamId, @"streamReactTag": streamId, @"tracks": stream[1]});
            } else {
                [rtc.localTracks removeObjectForKey:track.trackId];
                [rtc.localStreams removeObjectForKey:streamId];
                @synchronized (self) { self->_current = nil; self->_streamId = nil; }
                resolve(NSNull.null);
            }
        };
        __weak AetherLiDARCapture *pending = capture;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 4 * NSEC_PER_SEC), rtc.workerQueue, ^{
            AetherLiDARCapture *owner = pending;
            if (owner.startup) [owner abandon];
        });
    });
}

RCT_EXPORT_METHOD(cancelOpen) {
    @synchronized (self) {
        WebRTCModule *rtc = _rtc;
        if (!rtc) return;
        dispatch_async(rtc.workerQueue, ^{
            AetherLiDARCapture *capture;
            @synchronized (self) { capture = self->_current; }
            if (capture.startup) [capture abandon];
        });
    }
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(read:(NSString *)streamId) {
    @synchronized (self) {
        if (![_streamId isEqualToString:streamId]) return NSNull.null;
        NSDictionary *value = _current.sample;
        if (value) return value;
        return NSNull.null;
    }
}

RCT_EXPORT_METHOD(snapshot:(NSString *)streamId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    const NSTimeInterval start = CACurrentMediaTime();
    @synchronized (self) {
        WebRTCModule *rtc = _rtc;
        AetherLiDARCapture *capture = _current;
        if (UIApplication.sharedApplication.applicationState != UIApplicationStateActive ||
            !rtc || !capture || ![_streamId isEqualToString:streamId]) {
            resolve(NSNull.null);
            return;
        }
        dispatch_async(rtc.workerQueue, ^{ [capture requestSnapshot:resolve started:start]; });
    }
}

- (void)invalidate {
    @synchronized (self) {
        _invalidated = YES;
        AetherLiDARCapture *capture = _current;
        WebRTCModule *rtc = _rtc;
        if (rtc && capture) dispatch_async(rtc.workerQueue, ^{ [capture abandon]; });
        _current = nil;
        _streamId = nil;
    }
}
@end
