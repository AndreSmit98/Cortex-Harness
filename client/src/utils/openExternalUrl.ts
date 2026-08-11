type CortexWebKitWindow = Window & {
  webkit?: {
    messageHandlers?: {
      cortexOpenExternal?: {
        postMessage: (url: string) => void;
      };
    };
  };
};

/**
 * Opens an HTTP(S) URL outside Cortex. The macOS launcher exposes a small
 * WebKit message bridge because asynchronous OAuth responses are otherwise
 * treated as blocked popups. Regular browsers keep using window.open.
 */
export function openExternalUrl(url: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return;
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return;
  }

  const nativeHandler = (window as CortexWebKitWindow).webkit?.messageHandlers
    ?.cortexOpenExternal;
  if (nativeHandler) {
    nativeHandler.postMessage(parsedUrl.toString());
    return;
  }

  window.open(parsedUrl.toString(), '_blank', 'noopener,noreferrer');
}
