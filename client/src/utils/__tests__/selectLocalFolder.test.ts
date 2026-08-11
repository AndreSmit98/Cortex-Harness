import { canSelectLocalFolder, selectLocalFolder } from '../selectLocalFolder';

type TestWindow = Window & {
  webkit?: {
    messageHandlers?: {
      cortexSelectFolder?: {
        postMessage: (request: { currentPath?: string }) => Promise<unknown>;
      };
    };
  };
};

describe('selectLocalFolder', () => {
  const testWindow = window as TestWindow;
  let originalWebKit: TestWindow['webkit'];

  beforeEach(() => {
    originalWebKit = testWindow.webkit;
  });

  afterEach(() => {
    testWindow.webkit = originalWebKit;
    jest.restoreAllMocks();
  });

  test('reports whether the native picker bridge is available', () => {
    testWindow.webkit = undefined;
    expect(canSelectLocalFolder()).toBe(false);

    testWindow.webkit = {
      messageHandlers: {
        cortexSelectFolder: { postMessage: jest.fn() },
      },
    };
    expect(canSelectLocalFolder()).toBe(true);
  });

  test('returns the absolute directory selected by the native picker', async () => {
    const postMessage = jest.fn().mockResolvedValue('/Users/andre/Projects/example');
    testWindow.webkit = {
      messageHandlers: {
        cortexSelectFolder: { postMessage },
      },
    };

    await expect(selectLocalFolder(' /Users/andre/Projects ')).resolves.toBe(
      '/Users/andre/Projects/example',
    );
    expect(postMessage).toHaveBeenCalledWith({ currentPath: '/Users/andre/Projects' });
  });

  test.each([null, undefined, '', 'relative/folder', 42])(
    'treats a cancelled or invalid native result as no selection: %p',
    async (result) => {
      testWindow.webkit = {
        messageHandlers: {
          cortexSelectFolder: { postMessage: jest.fn().mockResolvedValue(result) },
        },
      };

      await expect(selectLocalFolder()).resolves.toBeNull();
    },
  );
});
