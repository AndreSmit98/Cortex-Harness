interface LoginManagerCallbackRelayOptions {
  location?: Location;
  history?: History;
  document?: Document;
  submit?: (form: HTMLFormElement) => void;
}

const CALLBACK_PATH = '/api/auth/login-manager/callback';

/**
 * Login Manager's only allowlisted local redirect is the frontend root. Relay
 * callback tokens to the same-origin backend before the React application
 * starts, and remove them from browser history immediately.
 */
export function relayLoginManagerCallback({
  location = window.location,
  history = window.history,
  document: documentRef = document,
  submit = (form) => form.submit(),
}: LoginManagerCallbackRelayOptions = {}): boolean {
  const url = new URL(location.href);
  const jwt = url.searchParams.get('jwt');
  const refresh = url.searchParams.get('refresh');
  if (!jwt && !refresh) {
    return false;
  }

  url.searchParams.delete('jwt');
  url.searchParams.delete('refresh');
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);

  const form = documentRef.createElement('form');
  form.method = 'post';
  form.action = CALLBACK_PATH;
  form.hidden = true;

  for (const [name, value] of [
    ['jwt', jwt],
    ['refresh', refresh],
  ] as const) {
    if (!value) {
      continue;
    }
    const input = documentRef.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  (documentRef.body ?? documentRef.documentElement).appendChild(form);
  submit(form);
  return true;
}
