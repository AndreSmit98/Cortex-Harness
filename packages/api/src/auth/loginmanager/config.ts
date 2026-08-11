import { createPublicKey } from 'crypto';
import { isEnabled } from '~/utils';
import type { LoginManagerConfig, LoginManagerPublicConfig } from './types';

const DEFAULT_BASE_URL = 'https://auth.myrsaweb.co.za';
const DEFAULT_CALLBACK_URL = 'https://auth.myrsaweb.co.za/api/v1/user/jwt_callback';
const DEFAULT_REFRESH_URL = 'https://auth.myrsaweb.co.za/api/v1/jwt/refresh';
const DEFAULT_LABEL = 'Continue with RSAWEB';

export class LoginManagerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginManagerConfigError';
  }
}

function required(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new LoginManagerConfigError(`${name} is required when Login Manager is enabled`);
  }
  return normalized;
}

function parseUrl(name: string, value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new LoginManagerConfigError(`${name} must be an absolute URL`);
  }
}

function parseRedirectUrl(value: string): URL {
  const url = parseUrl('LOGIN_MANAGER_REDIRECT_URL', value);
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (isLocal && value !== 'http://localhost:5174') {
    throw new LoginManagerConfigError(
      'Local LOGIN_MANAGER_REDIRECT_URL must be exactly http://localhost:5174',
    );
  }
  return url;
}

function parseBase64(name: string, value: string): Buffer {
  const normalized = value.replace(/\s+/g, '');
  const decoded = Buffer.from(normalized, 'base64');
  if (!normalized || !decoded.length) {
    throw new LoginManagerConfigError(`${name} must be valid Base64`);
  }
  return decoded;
}

function parsePublicKey(value: string): string {
  const decoded = parseBase64('LOGIN_MANAGER_PUBLIC_KEY_B64', value).toString('utf8');
  try {
    const key = createPublicKey(decoded);
    if (key.asymmetricKeyType !== 'rsa' && key.asymmetricKeyType !== 'rsa-pss') {
      throw new Error('not RSA');
    }
  } catch {
    throw new LoginManagerConfigError(
      'LOGIN_MANAGER_PUBLIC_KEY_B64 must contain an RSA public key',
    );
  }
  return decoded;
}

function parseEncryptionKey(value: string): Buffer {
  const key = parseBase64('LOGIN_MANAGER_TOKEN_ENCRYPTION_KEY_B64', value);
  if (key.length !== 32) {
    throw new LoginManagerConfigError(
      'LOGIN_MANAGER_TOKEN_ENCRYPTION_KEY_B64 must decode to exactly 32 bytes',
    );
  }
  return key;
}

function parseAudience(value: string): string | string[] {
  const audience = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!audience.length) {
    throw new LoginManagerConfigError('LOGIN_MANAGER_EXPECTED_AUD is required');
  }
  return audience.length === 1 ? audience[0] : audience;
}

export function isLoginManagerEnabled(): boolean {
  return isEnabled(process.env.LOGIN_MANAGER_ENABLED);
}

export function getLoginManagerConfig(): LoginManagerConfig {
  if (!isLoginManagerEnabled()) {
    throw new LoginManagerConfigError('Login Manager is disabled');
  }

  required('DOMAIN_SERVER', process.env.DOMAIN_SERVER);
  const clientDomain = required('DOMAIN_CLIENT', process.env.DOMAIN_CLIENT);
  const redirect =
    process.env.LOGIN_MANAGER_REDIRECT_URL?.trim() || clientDomain.replace(/\/+$/, '');
  const successRedirect =
    process.env.LOGIN_MANAGER_SUCCESS_REDIRECT_URL?.trim() ||
    `${clientDomain.replace(/\/+$/, '')}/c/new`;
  const failureRedirect = `${clientDomain.replace(/\/+$/, '')}/login`;

  return {
    baseUrl: parseUrl(
      'LOGIN_MANAGER_BASE_URL',
      process.env.LOGIN_MANAGER_BASE_URL?.trim() || DEFAULT_BASE_URL,
    ),
    callbackUrl: parseUrl(
      'LOGIN_MANAGER_CALLBACK_URL',
      process.env.LOGIN_MANAGER_CALLBACK_URL?.trim() || DEFAULT_CALLBACK_URL,
    ),
    refreshUrl: parseUrl(
      'LOGIN_MANAGER_REFRESH_URL',
      process.env.LOGIN_MANAGER_REFRESH_URL?.trim() || DEFAULT_REFRESH_URL,
    ),
    redirectUrl: parseRedirectUrl(redirect),
    successRedirectUrl: parseUrl('LOGIN_MANAGER_SUCCESS_REDIRECT_URL', successRedirect),
    failureRedirectUrl: parseUrl('DOMAIN_CLIENT', failureRedirect),
    publicKey: parsePublicKey(
      required('LOGIN_MANAGER_PUBLIC_KEY_B64', process.env.LOGIN_MANAGER_PUBLIC_KEY_B64),
    ),
    encryptionKey: parseEncryptionKey(
      required(
        'LOGIN_MANAGER_TOKEN_ENCRYPTION_KEY_B64',
        process.env.LOGIN_MANAGER_TOKEN_ENCRYPTION_KEY_B64,
      ),
    ),
    expectedIssuer: required('LOGIN_MANAGER_EXPECTED_ISS', process.env.LOGIN_MANAGER_EXPECTED_ISS),
    expectedAudience: parseAudience(
      required('LOGIN_MANAGER_EXPECTED_AUD', process.env.LOGIN_MANAGER_EXPECTED_AUD),
    ),
    expectedFlow: process.env.LOGIN_MANAGER_FLOW?.trim() || 'standard',
    label: process.env.LOGIN_MANAGER_BUTTON_LABEL?.trim() || DEFAULT_LABEL,
    authDebug: isEnabled(process.env.LOGIN_MANAGER_AUTH_DEBUG),
  };
}

export function getLoginManagerPublicConfig(): LoginManagerPublicConfig {
  if (!isLoginManagerEnabled()) {
    return { enabled: false, label: DEFAULT_LABEL };
  }
  try {
    const config = getLoginManagerConfig();
    return { enabled: true, label: config.label };
  } catch {
    return {
      enabled: false,
      label: process.env.LOGIN_MANAGER_BUTTON_LABEL?.trim() || DEFAULT_LABEL,
    };
  }
}
