import { openExternalUrl } from '../openExternalUrl';

type TestWindow = Window & {
  webkit?: {
    messageHandlers?: {
      cortexOpenExternal?: {
        postMessage: (url: string) => void;
      };
    };
  };
};

describe('openExternalUrl', () => {
  const testWindow = window as TestWindow;
  let originalWebKit: TestWindow['webkit'];

  beforeEach(() => {
    originalWebKit = testWindow.webkit;
  });

  afterEach(() => {
    testWindow.webkit = originalWebKit;
    jest.restoreAllMocks();
  });

  test('uses the Cortex native bridge when it is available', () => {
    const postMessage = jest.fn();
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    testWindow.webkit = {
      messageHandlers: {
        cortexOpenExternal: { postMessage },
      },
    };

    openExternalUrl('https://oauth.example/authorize?x=1');

    expect(postMessage).toHaveBeenCalledWith('https://oauth.example/authorize?x=1');
    expect(openSpy).not.toHaveBeenCalled();
  });

  test('uses a new browser tab when the native bridge is unavailable', () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    testWindow.webkit = undefined;

    openExternalUrl('https://oauth.example/authorize?x=1');

    expect(openSpy).toHaveBeenCalledWith(
      'https://oauth.example/authorize?x=1',
      '_blank',
      'noopener,noreferrer',
    );
  });

  test.each(['not a URL', 'file:///tmp/token', 'javascript:alert(1)'])(
    'rejects a non-HTTP(S) URL: %s',
    (url) => {
      const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
      const postMessage = jest.fn();
      testWindow.webkit = {
        messageHandlers: {
          cortexOpenExternal: { postMessage },
        },
      };

      openExternalUrl(url);

      expect(postMessage).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
    },
  );
});
