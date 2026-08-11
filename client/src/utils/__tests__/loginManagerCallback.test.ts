import { relayLoginManagerCallback } from '../loginManagerCallback';

describe('relayLoginManagerCallback', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
  });

  it('does nothing without Login Manager callback parameters', () => {
    const submit = jest.fn();

    expect(relayLoginManagerCallback({ submit })).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it('removes tokens from browser history and posts them to the backend callback', () => {
    const submit = jest.fn();
    window.history.replaceState(
      {},
      '',
      '/?jwt=header.payload.signature&refresh=refresh.payload.signature&safe=value',
    );

    expect(relayLoginManagerCallback({ submit })).toBe(true);
    expect(window.location.href).toBe(`${window.location.origin}/?safe=value`);
    expect(submit).toHaveBeenCalledTimes(1);

    const form = submit.mock.calls[0][0] as HTMLFormElement;
    expect(form.method).toBe('post');
    expect(form.getAttribute('action')).toBe('/api/auth/login-manager/callback');
    expect(new FormData(form).get('jwt')).toBe('header.payload.signature');
    expect(new FormData(form).get('refresh')).toBe('refresh.payload.signature');
  });
});
