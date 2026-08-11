type FolderPickerHandler = {
  postMessage: (request: { currentPath?: string }) => Promise<unknown>;
};

type CortexFolderPickerWindow = Window & {
  webkit?: {
    messageHandlers?: {
      cortexSelectFolder?: FolderPickerHandler;
    };
  };
};

function getFolderPickerHandler(): FolderPickerHandler | undefined {
  return (window as CortexFolderPickerWindow).webkit?.messageHandlers?.cortexSelectFolder;
}

export function canSelectLocalFolder(): boolean {
  return getFolderPickerHandler() != null;
}

/** Opens the Cortex macOS directory picker and returns the selected absolute path. */
export async function selectLocalFolder(currentPath?: string): Promise<string | null> {
  const handler = getFolderPickerHandler();
  if (!handler) {
    return null;
  }

  const result = await handler.postMessage({
    ...(currentPath?.trim() ? { currentPath: currentPath.trim() } : {}),
  });
  return typeof result === 'string' && result.startsWith('/') ? result : null;
}
