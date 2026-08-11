#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <WebKit/WebKit.h>

@interface CortexAppDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate,
                                         WKScriptMessageHandler, WKScriptMessageHandlerWithReply>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSTimer *startupTimer;
@property(nonatomic, strong) NSTask *serverProcess;
@property(nonatomic, strong) NSURL *chatURL;
@property(nonatomic, strong) NSURL *logURL;
@property(nonatomic, strong) NSURL *webLogURL;
@property(nonatomic, assign) BOOL didStartServer;
@property(nonatomic, assign) NSInteger startupAttempts;
@end

@implementation CortexAppDelegate

static NSString *const CortexProjectDirectory =
    @"/Users/andresmit/Documents/RSAWEB/GitHub/Cortex-Harness";

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  (void)notification;
  [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
  [self configureMainMenu];

  self.chatURL = [NSURL URLWithString:@"http://localhost:5174/"];
  self.logURL = [NSURL fileURLWithPath:@"/tmp/cortex-harness.log"];
  self.webLogURL = [NSURL fileURLWithPath:@"/tmp/cortex-webview.log"];
  [[NSFileManager defaultManager] createFileAtPath:self.webLogURL.path contents:nil attributes:nil];

  WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
  configuration.websiteDataStore = [WKWebsiteDataStore defaultDataStore];
  [configuration.userContentController addScriptMessageHandler:self name:@"cortexLog"];
  [configuration.userContentController addScriptMessageHandler:self name:@"cortexOpenExternal"];
  [configuration.userContentController addScriptMessageHandlerWithReply:self
                                                            contentWorld:WKContentWorld.pageWorld
                                                                    name:@"cortexSelectFolder"];
  NSString *diagnosticScript =
      @"(() => {"
       "const send = (type, value) => {"
       "  try {"
       "    const detail = value && value.stack ? value.stack : String(value);"
       "    window.webkit.messageHandlers.cortexLog.postMessage(type + ': ' + detail);"
       "  } catch (_) {}"
       "};"
       "window.addEventListener('error', (event) => send('error', event.error || event.message));"
       "window.addEventListener('unhandledrejection', (event) => send('unhandledrejection', event.reason));"
       "const originalConsoleError = console.error.bind(console);"
       "console.error = (...values) => {"
       "  send('console.error', values.map((value) => value && value.stack ? value.stack : String(value)).join(' '));"
       "  originalConsoleError(...values);"
       "};"
       "})();";
  WKUserScript *captureFrontendErrors =
      [[WKUserScript alloc] initWithSource:diagnosticScript
                            injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                         forMainFrameOnly:YES];
  [configuration.userContentController addUserScript:captureFrontendErrors];
  NSString *refreshScript =
      @"(() => {"
       "const refreshKey = 'cortex-native-assets-v3';"
       "if (sessionStorage.getItem(refreshKey) === 'done') return;"
       "sessionStorage.setItem(refreshKey, 'done');"
       "const unregisterWorkers = navigator.serviceWorker"
       "  ? navigator.serviceWorker.getRegistrations().then((registrations) =>"
       "      Promise.all(registrations.map((registration) => registration.unregister())))"
       "  : Promise.resolve();"
       "const clearAssetCaches = globalThis.caches"
       "  ? caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))"
       "  : Promise.resolve();"
       "Promise.all([unregisterWorkers, clearAssetCaches]).finally(() =>"
       "  globalThis.setTimeout(() => globalThis.location.reload(), 0));"
       "})();";
  WKUserScript *refreshFrontendAssets =
      [[WKUserScript alloc] initWithSource:refreshScript
                            injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                         forMainFrameOnly:YES];
  [configuration.userContentController addUserScript:refreshFrontendAssets];
  self.webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:configuration];
  self.webView.navigationDelegate = self;
  self.webView.UIDelegate = self;
  [self.webView setValue:@NO forKey:@"drawsBackground"];

  self.window = [[NSWindow alloc]
      initWithContentRect:NSMakeRect(0, 0, 1440, 920)
                styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                          NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
                  backing:NSBackingStoreBuffered
                    defer:NO];
  self.window.title = @"Cortex";
  self.window.minSize = NSMakeSize(960, 640);
  self.window.contentView = self.webView;
  [self.window center];
  [self.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];

  [self showStatus:@"Starting Cortex Harness…" detail:@"Preparing the local workspace."];
  [self probeLocalChat];
}

- (void)configureMainMenu {
  NSMenu *mainMenu = [[NSMenu alloc] initWithTitle:@""];

  NSMenuItem *applicationMenuItem = [[NSMenuItem alloc] initWithTitle:@"Cortex"
                                                               action:nil
                                                        keyEquivalent:@""];
  [mainMenu addItem:applicationMenuItem];
  NSMenu *applicationMenu = [[NSMenu alloc] initWithTitle:@"Cortex"];
  [applicationMenu
      addItemWithTitle:@"About Cortex"
                action:@selector(orderFrontStandardAboutPanel:)
         keyEquivalent:@""];
  [applicationMenu addItem:[NSMenuItem separatorItem]];
  [applicationMenu addItemWithTitle:@"Hide Cortex"
                              action:@selector(hide:)
                       keyEquivalent:@"h"];
  NSMenuItem *hideOthers = [applicationMenu addItemWithTitle:@"Hide Others"
                                                       action:@selector(hideOtherApplications:)
                                                keyEquivalent:@"h"];
  hideOthers.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagOption;
  [applicationMenu addItemWithTitle:@"Show All"
                              action:@selector(unhideAllApplications:)
                       keyEquivalent:@""];
  [applicationMenu addItem:[NSMenuItem separatorItem]];
  [applicationMenu addItemWithTitle:@"Quit Cortex"
                              action:@selector(terminate:)
                       keyEquivalent:@"q"];
  applicationMenuItem.submenu = applicationMenu;

  NSMenuItem *editMenuItem = [[NSMenuItem alloc] initWithTitle:@"Edit"
                                                         action:nil
                                                  keyEquivalent:@""];
  [mainMenu addItem:editMenuItem];
  NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
  [editMenu addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
  NSMenuItem *redoItem = [editMenu addItemWithTitle:@"Redo"
                                             action:@selector(redo:)
                                      keyEquivalent:@"z"];
  redoItem.keyEquivalentModifierMask = NSEventModifierFlagCommand | NSEventModifierFlagShift;
  [editMenu addItem:[NSMenuItem separatorItem]];
  [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
  [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
  [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
  NSMenuItem *pasteAndMatchStyle =
      [editMenu addItemWithTitle:@"Paste and Match Style"
                          action:@selector(pasteAsPlainText:)
                   keyEquivalent:@"v"];
  pasteAndMatchStyle.keyEquivalentModifierMask =
      NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagShift;
  [editMenu addItemWithTitle:@"Delete" action:@selector(delete:) keyEquivalent:@""];
  [editMenu addItem:[NSMenuItem separatorItem]];
  [editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
  editMenuItem.submenu = editMenu;

  NSMenuItem *windowMenuItem = [[NSMenuItem alloc] initWithTitle:@"Window"
                                                           action:nil
                                                    keyEquivalent:@""];
  [mainMenu addItem:windowMenuItem];
  NSMenu *windowMenu = [[NSMenu alloc] initWithTitle:@"Window"];
  [windowMenu addItemWithTitle:@"Minimize" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
  [windowMenu addItemWithTitle:@"Zoom" action:@selector(performZoom:) keyEquivalent:@""];
  [windowMenu addItem:[NSMenuItem separatorItem]];
  [windowMenu addItemWithTitle:@"Bring All to Front"
                         action:@selector(arrangeInFront:)
                  keyEquivalent:@""];
  windowMenuItem.submenu = windowMenu;
  NSApp.windowsMenu = windowMenu;

  NSApp.mainMenu = mainMenu;
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
  (void)sender;
  return YES;
}

- (void)applicationWillTerminate:(NSNotification *)notification {
  (void)notification;
  [self.startupTimer invalidate];
  if (self.serverProcess.running) {
    [self.serverProcess terminate];
  }
}

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction
                   decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
  (void)webView;
  NSURL *url = navigationAction.request.URL;
  if (url == nil) {
    decisionHandler(WKNavigationActionPolicyCancel);
    return;
  }

  NSString *scheme = url.scheme.lowercaseString ?: @"";
  NSSet<NSString *> *embeddedSchemes = [NSSet setWithObjects:@"about", @"data", @"blob", nil];
  if ([self isHarnessURL:url] || [embeddedSchemes containsObject:scheme]) {
    decisionHandler(WKNavigationActionPolicyAllow);
    return;
  }

  if ([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"]) {
    [[NSWorkspace sharedWorkspace] openURL:url];
    decisionHandler(WKNavigationActionPolicyCancel);
    return;
  }

  decisionHandler(WKNavigationActionPolicyAllow);
}

- (WKWebView *)webView:(WKWebView *)webView
    createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
               forNavigationAction:(WKNavigationAction *)navigationAction
                    windowFeatures:(WKWindowFeatures *)windowFeatures {
  (void)webView;
  (void)configuration;
  (void)windowFeatures;
  NSURL *url = navigationAction.request.URL;
  if (url != nil) {
    if ([self isHarnessURL:url]) {
      [self.webView loadRequest:navigationAction.request];
    } else {
      [[NSWorkspace sharedWorkspace] openURL:url];
    }
  }
  return nil;
}

- (void)webView:(WKWebView *)webView
    didFailNavigation:(WKNavigation *)navigation
            withError:(NSError *)error {
  (void)webView;
  (void)navigation;
  if ([error.domain isEqualToString:NSURLErrorDomain] && error.code == NSURLErrorCancelled) {
    return;
  }
  [self showFailure:@"Cortex could not load its local page." error:error];
}

- (void)webView:(WKWebView *)webView
    didFailProvisionalNavigation:(WKNavigation *)navigation
                       withError:(NSError *)error {
  (void)webView;
  (void)navigation;
  if ([error.domain isEqualToString:NSURLErrorDomain] && error.code == NSURLErrorCancelled) {
    return;
  }
  [self showFailure:@"Cortex could not connect to its local server." error:error];
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
  (void)webView;
  [self showStatus:@"Reloading Cortex Harness…" detail:@"The embedded browser restarted."];
  [self probeLocalChat];
}

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
  (void)userContentController;
  if ([message.name isEqualToString:@"cortexOpenExternal"] &&
      [message.body isKindOfClass:[NSString class]]) {
    NSURL *url = [NSURL URLWithString:(NSString *)message.body];
    NSString *scheme = url.scheme.lowercaseString ?: @"";
    if (url != nil &&
        ([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"])) {
      [[NSWorkspace sharedWorkspace] openURL:url];
    }
    return;
  }

  if (![message.name isEqualToString:@"cortexLog"]) {
    return;
  }

  NSString *line = [NSString stringWithFormat:@"%@\n", message.body];
  NSData *data = [line dataUsingEncoding:NSUTF8StringEncoding];
  NSFileHandle *handle = [NSFileHandle fileHandleForWritingAtPath:self.webLogURL.path];
  [handle seekToEndOfFile];
  [handle writeData:data];
  [handle closeFile];
}

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message
                 replyHandler:(void (^)(id _Nullable reply,
                                        NSString *_Nullable errorMessage))replyHandler {
  (void)userContentController;
  if (![message.name isEqualToString:@"cortexSelectFolder"]) {
    replyHandler(nil, @"Unsupported Cortex native request");
    return;
  }

  NSOpenPanel *panel = [NSOpenPanel openPanel];
  panel.title = @"Choose a project folder";
  panel.message = @"Cortex will use this folder as the project's local workspace.";
  panel.prompt = @"Choose";
  panel.canChooseFiles = NO;
  panel.canChooseDirectories = YES;
  panel.allowsMultipleSelection = NO;
  panel.canCreateDirectories = YES;
  panel.resolvesAliases = YES;

  if ([message.body isKindOfClass:[NSDictionary class]]) {
    id currentPath = ((NSDictionary *)message.body)[@"currentPath"];
    BOOL isDirectory = NO;
    if ([currentPath isKindOfClass:[NSString class]] &&
        [[NSFileManager defaultManager] fileExistsAtPath:currentPath isDirectory:&isDirectory] &&
        isDirectory) {
      panel.directoryURL = [NSURL fileURLWithPath:currentPath isDirectory:YES];
    }
  }

  [panel beginSheetModalForWindow:self.window
                completionHandler:^(NSModalResponse result) {
                  if (result == NSModalResponseOK && panel.URL.path.length > 0) {
                    replyHandler(panel.URL.path, nil);
                  } else {
                    replyHandler([NSNull null], nil);
                  }
                }];
}

- (BOOL)isHarnessURL:(NSURL *)url {
  NSString *host = url.host.lowercaseString ?: @"";
  BOOL localHost = [host isEqualToString:@"localhost"] || [host isEqualToString:@"127.0.0.1"];
  NSInteger urlPort = url.port != nil ? url.port.integerValue : 80;
  NSInteger harnessPort = self.chatURL.port.integerValue;
  return localHost && urlPort == harnessPort;
}

- (void)probeLocalChat {
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:self.chatURL];
  request.timeoutInterval = 0.75;

  __weak typeof(self) weakSelf = self;
  [[[NSURLSession sharedSession]
      dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
          (void)data;
          (void)error;
          BOOL isReady = [response isKindOfClass:[NSHTTPURLResponse class]] &&
                         ((NSHTTPURLResponse *)response).statusCode == 200;
          dispatch_async(dispatch_get_main_queue(), ^{
            typeof(self) self = weakSelf;
            if (self == nil) {
              return;
            }

            if (isReady) {
              [self.startupTimer invalidate];
              self.startupTimer = nil;
              [self.webView loadRequest:[NSURLRequest requestWithURL:self.chatURL]];
              return;
            }

            if (!self.didStartServer) {
              self.didStartServer = YES;
              [self startLocalChat];
            }

            self.startupAttempts += 1;
            if (self.startupAttempts >= 120) {
              [self.startupTimer invalidate];
              self.startupTimer = nil;
              [self showFailure:@"Cortex Harness did not start within 60 seconds." error:nil];
              return;
            }

            if (self.startupTimer == nil) {
              self.startupTimer = [NSTimer scheduledTimerWithTimeInterval:0.5
                                                                  repeats:YES
                                                                    block:^(NSTimer *timer) {
                                                                      (void)timer;
                                                                      [weakSelf probeLocalChat];
                                                                    }];
            }
          });
        }] resume];
}

- (void)startLocalChat {
  NSString *scriptPath = [CortexProjectDirectory
      stringByAppendingPathComponent:@"scripts/local-eval-server.mjs"];
  if (![[NSFileManager defaultManager] fileExistsAtPath:scriptPath]) {
    [self showFailure:@"The Cortex Harness launcher could not find its startup script." error:nil];
    return;
  }

  NSString *nodeExecutable = [self findNodeExecutable];
  if (nodeExecutable == nil) {
    [self showFailure:@"The Cortex Harness launcher could not find Node.js." error:nil];
    return;
  }

  [[NSFileManager defaultManager] createFileAtPath:self.logURL.path contents:nil attributes:nil];
  NSFileHandle *logHandle = [NSFileHandle fileHandleForWritingAtPath:self.logURL.path];
  [logHandle truncateFileAtOffset:0];

  NSTask *process = [[NSTask alloc] init];
  process.executableURL = [NSURL fileURLWithPath:nodeExecutable];
  process.arguments = @[ scriptPath ];
  process.currentDirectoryURL = [NSURL fileURLWithPath:CortexProjectDirectory];
  process.standardOutput = logHandle;
  process.standardError = logHandle;
  process.standardInput = [NSFileHandle fileHandleWithNullDevice];

  __weak typeof(self) weakSelf = self;
  process.terminationHandler = ^(NSTask *finishedProcess) {
    dispatch_async(dispatch_get_main_queue(), ^{
      typeof(self) self = weakSelf;
      if (self == nil || finishedProcess.terminationStatus == 0) {
        return;
      }
      NSString *message = [NSString
          stringWithFormat:@"Cortex Harness stopped during startup (exit code %d).",
                           finishedProcess.terminationStatus];
      [self showFailure:message error:nil];
    });
  };

  self.serverProcess = process;
  NSError *runError = nil;
  if (![process launchAndReturnError:&runError]) {
    [self showFailure:@"The Cortex Harness local server could not be started." error:runError];
  }
}

- (NSString *)findNodeExecutable {
  NSFileManager *fileManager = [NSFileManager defaultManager];
  NSMutableArray<NSString *> *candidates = [NSMutableArray array];
  NSString *nvmRoot = @"/Users/andresmit/.nvm/versions/node";
  NSArray<NSString *> *versions = [fileManager contentsOfDirectoryAtPath:nvmRoot error:nil];
  versions = [versions sortedArrayUsingSelector:@selector(localizedStandardCompare:)].reverseObjectEnumerator.allObjects;
  for (NSString *version in versions) {
    [candidates addObject:[NSString stringWithFormat:@"%@/%@/bin/node", nvmRoot, version]];
  }

  [candidates addObjectsFromArray:@[
    @"/Users/andresmit/.nvm/versions/node/v24.18.1/bin/node",
    @"/opt/homebrew/bin/node",
    @"/usr/local/bin/node",
    @"/usr/bin/node",
  ]];

  NSString *path = [NSProcessInfo processInfo].environment[@"PATH"];
  for (NSString *directory in [path componentsSeparatedByString:@":"]) {
    [candidates addObject:[directory stringByAppendingPathComponent:@"node"]];
  }

  for (NSString *candidate in candidates) {
    if ([fileManager isExecutableFileAtPath:candidate]) {
      return candidate;
    }
  }
  return nil;
}

- (void)showFailure:(NSString *)message error:(NSError *)error {
  [self.startupTimer invalidate];
  self.startupTimer = nil;
  NSString *errorDetail = error != nil ? [NSString stringWithFormat:@"\n%@", error.localizedDescription] : @"";
  NSString *detail = [NSString
      stringWithFormat:@"%@\n%@\n\nLog: %@", errorDetail, [self readLogExcerpt], self.logURL.path];
  [self showStatus:message detail:detail];
}

- (NSString *)readLogExcerpt {
  NSString *contents = [NSString stringWithContentsOfURL:self.logURL
                                                 encoding:NSUTF8StringEncoding
                                                    error:nil];
  if (contents.length == 0) {
    return @"No startup log was produced.";
  }

  NSArray<NSString *> *lines = [contents componentsSeparatedByCharactersInSet:[NSCharacterSet newlineCharacterSet]];
  NSInteger start = MAX(0, (NSInteger)lines.count - 24);
  return [[lines subarrayWithRange:NSMakeRange(start, lines.count - start)] componentsJoinedByString:@"\n"];
}

- (void)showStatus:(NSString *)title detail:(NSString *)detail {
  NSString *html = [NSString stringWithFormat:
      @"<!doctype html><html><head><meta charset='utf-8'>"
       "<meta name='color-scheme' content='light dark'><style>"
       "body{margin:0;min-height:100vh;display:grid;place-items:center;"
       "font:15px -apple-system,BlinkMacSystemFont,sans-serif;background:#101114;color:#f4f4f5}"
       "main{width:min(720px,calc(100vw - 80px));padding:36px;border:1px solid #303238;"
       "border-radius:18px;background:#18191d}h1{margin:0 0 14px;font-size:24px}"
       "pre{margin:0;color:#b9bbc3;white-space:pre-wrap;overflow-wrap:anywhere;"
       "font:13px ui-monospace,SFMono-Regular,Menlo,monospace}</style></head>"
       "<body><main><h1>%@</h1><pre>%@</pre></main></body></html>",
      [self escapeHTML:title], [self escapeHTML:detail]];
  [self.webView loadHTMLString:html baseURL:nil];
}

- (NSString *)escapeHTML:(NSString *)value {
  NSString *escaped = [value stringByReplacingOccurrencesOfString:@"&" withString:@"&amp;"];
  escaped = [escaped stringByReplacingOccurrencesOfString:@"<" withString:@"&lt;"];
  escaped = [escaped stringByReplacingOccurrencesOfString:@">" withString:@"&gt;"];
  return [escaped stringByReplacingOccurrencesOfString:@"\"" withString:@"&quot;"];
}

@end

int main(int argc, const char *argv[]) {
  (void)argc;
  (void)argv;
  @autoreleasepool {
    NSApplication *application = [NSApplication sharedApplication];
    CortexAppDelegate *appDelegate = [[CortexAppDelegate alloc] init];
    application.delegate = appDelegate;
    [application setActivationPolicy:NSApplicationActivationPolicyRegular];
    [application run];
  }
  return 0;
}
