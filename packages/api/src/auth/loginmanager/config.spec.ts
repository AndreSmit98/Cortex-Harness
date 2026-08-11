import { generateKeyPairSync } from 'crypto';
import { getLoginManagerPublicConfig } from './config';

const names = [
  'DOMAIN_CLIENT',
  'DOMAIN_SERVER',
  'LOGIN_MANAGER_ENABLED',
  'LOGIN_MANAGER_PUBLIC_KEY_B64',
  'LOGIN_MANAGER_TOKEN_ENCRYPTION_KEY_B64',
  'LOGIN_MANAGER_EXPECTED_ISS',
  'LOGIN_MANAGER_EXPECTED_AUD',
  'LOGIN_MANAGER_BUTTON_LABEL',
  'LOGIN_MANAGER_REDIRECT_URL',
] as const;
const originalEnv = Object.fromEntries(names.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of names) {
    const value = originalEnv[name];
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('Login Manager public startup config', () => {
  it('exposes only a disabled flag and safe display label when disabled', () => {
    process.env.LOGIN_MANAGER_ENABLED = 'false';
    expect(getLoginManagerPublicConfig()).toEqual({
      enabled: false,
      label: 'Continue with RSAWEB',
    });
  });

  it('fails closed when enabled but incomplete', () => {
    process.env.LOGIN_MANAGER_ENABLED = 'true';
    delete process.env.LOGIN_MANAGER_PUBLIC_KEY_B64;
    expect(getLoginManagerPublicConfig().enabled).toBe(false);
  });

  it('never exposes verification or encryption material', () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.DOMAIN_SERVER = 'http://localhost:3000';
    process.env.DOMAIN_CLIENT = 'http://localhost:5174';
    process.env.LOGIN_MANAGER_ENABLED = 'true';
    process.env.LOGIN_MANAGER_PUBLIC_KEY_B64 = Buffer.from(
      publicKey.export({ type: 'spki', format: 'pem' }),
    ).toString('base64');
    process.env.LOGIN_MANAGER_TOKEN_ENCRYPTION_KEY_B64 = Buffer.alloc(32, 3).toString('base64');
    process.env.LOGIN_MANAGER_EXPECTED_ISS = 'https://issuer.example.com';
    process.env.LOGIN_MANAGER_EXPECTED_AUD = 'cortex';
    process.env.LOGIN_MANAGER_BUTTON_LABEL = 'RSAWEB SSO';

    const publicConfig = getLoginManagerPublicConfig();
    expect(publicConfig).toEqual({ enabled: true, label: 'RSAWEB SSO' });
    expect(publicConfig).not.toHaveProperty('publicKey');
    expect(publicConfig).not.toHaveProperty('encryptionKey');
  });

  it('fails closed for any non-allowlisted localhost redirect', () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.DOMAIN_SERVER = 'http://localhost:3000';
    process.env.DOMAIN_CLIENT = 'http://localhost:5174';
    process.env.LOGIN_MANAGER_ENABLED = 'true';
    process.env.LOGIN_MANAGER_REDIRECT_URL =
      'http://localhost:3000/api/auth/login-manager/callback';
    process.env.LOGIN_MANAGER_PUBLIC_KEY_B64 = Buffer.from(
      publicKey.export({ type: 'spki', format: 'pem' }),
    ).toString('base64');
    process.env.LOGIN_MANAGER_TOKEN_ENCRYPTION_KEY_B64 = Buffer.alloc(32, 3).toString('base64');
    process.env.LOGIN_MANAGER_EXPECTED_ISS = 'https://issuer.example.com';
    process.env.LOGIN_MANAGER_EXPECTED_AUD = 'cortex';

    expect(getLoginManagerPublicConfig().enabled).toBe(false);
  });
});
