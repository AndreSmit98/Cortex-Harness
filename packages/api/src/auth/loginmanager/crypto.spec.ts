import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import type { LoginManagerConfig } from './types';
import { LoginManagerTokenError, verifyAccessToken } from './crypto';

const now = Math.floor(Date.now() / 1000);
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherRsa = generateKeyPairSync('rsa', { modulusLength: 2048 });

const config: LoginManagerConfig = {
  baseUrl: new URL('https://auth.example.com'),
  callbackUrl: new URL('https://auth.example.com/callback'),
  refreshUrl: new URL('https://auth.example.com/refresh'),
  redirectUrl: new URL('http://localhost:5174'),
  successRedirectUrl: new URL('http://localhost:5174/c/new'),
  failureRedirectUrl: new URL('http://localhost:5174/login'),
  publicKey: rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  encryptionKey: Buffer.alloc(32, 1),
  expectedIssuer: 'https://issuer.example.com',
  expectedAudience: 'cortex',
  expectedFlow: 'standard',
  label: 'Continue with RSAWEB',
  authDebug: false,
};

const claims = {
  iss: config.expectedIssuer,
  aud: config.expectedAudience,
  iat: now,
  nbf: now - 1,
  exp: now + 120,
  jti: 'jti-1',
  sub: 'sub-1',
  email: 'person@example.com',
  email_verified: true,
  flow: 'standard',
  type: 'access',
  token_use: 'id',
  'custom:users_id': 'rsaweb-user-1',
};

function sign(
  overrides: Partial<typeof claims> = {},
  privateKey: typeof rsa.privateKey = rsa.privateKey,
  algorithm: jwt.Algorithm = 'RS256',
): string {
  return jwt.sign({ ...claims, ...overrides }, privateKey, { algorithm });
}

describe('Login Manager JWT verification', () => {
  it('accepts a valid signed access JWT', () => {
    expect(verifyAccessToken(sign(), config)).toMatchObject({
      email: claims.email,
      'custom:users_id': claims['custom:users_id'],
    });
  });

  it('rejects an invalid signature', () => {
    expect(() => verifyAccessToken(sign({}, otherRsa.privateKey), config)).toThrow(
      LoginManagerTokenError,
    );
  });

  it('rejects the wrong signing algorithm', () => {
    expect(() => verifyAccessToken(sign({}, rsa.privateKey, 'PS256'), config)).toThrow(
      LoginManagerTokenError,
    );
  });

  it('rejects the wrong issuer', () => {
    expect(() => verifyAccessToken(sign({ iss: 'https://wrong.example.com' }), config)).toThrow(
      LoginManagerTokenError,
    );
  });

  it('rejects the wrong audience', () => {
    expect(() => verifyAccessToken(sign({ aud: 'wrong-client' }), config)).toThrow(
      LoginManagerTokenError,
    );
  });

  it('rejects an expired token', () => {
    expect(() => verifyAccessToken(sign({ exp: now - 1 }), config)).toThrow(LoginManagerTokenError);
  });

  it('rejects a not-yet-valid token', () => {
    expect(() => verifyAccessToken(sign({ nbf: now + 60 }), config)).toThrow(
      LoginManagerTokenError,
    );
  });

  it('rejects an unverified email', () => {
    expect(() => verifyAccessToken(sign({ email_verified: false }), config)).toThrow(
      LoginManagerTokenError,
    );
  });

  it('rejects the wrong Login Manager flow or token type', () => {
    expect(() => verifyAccessToken(sign({ flow: 'supabase' }), config)).toThrow(
      LoginManagerTokenError,
    );
    expect(() => verifyAccessToken(sign({ type: 'refresh' }), config)).toThrow(
      LoginManagerTokenError,
    );
  });
});
