import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import type { LoginManagerClaims, LoginManagerConfig } from './types';

const TOKEN_PARTS = 3;

export class LoginManagerTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginManagerTokenError';
  }
}

export function randomOpaqueValue(): string {
  return randomBytes(32).toString('base64url');
}

export function hashOpaqueValue(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function encryptToken(token: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptToken(value: string, key: Buffer): string {
  const parts = value.split('.');
  if (parts.length !== TOKEN_PARTS) {
    throw new LoginManagerTokenError('Stored refresh token is malformed');
  }
  try {
    const [iv, authTag, encrypted] = parts.map((part) => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    throw new LoginManagerTokenError('Stored refresh token cannot be decrypted');
  }
}

function isStringArray(value: object | string | string[] | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function assertCommonClaims(payload: jwt.JwtPayload): asserts payload is LoginManagerClaims {
  if (
    typeof payload.iss !== 'string' ||
    (typeof payload.aud !== 'string' && !isStringArray(payload.aud)) ||
    typeof payload.exp !== 'number' ||
    typeof payload.nbf !== 'number' ||
    typeof payload.iat !== 'number' ||
    typeof payload.jti !== 'string'
  ) {
    throw new LoginManagerTokenError('Login Manager JWT is missing required standard claims');
  }
}

function verifyCommon(token: string, config: LoginManagerConfig): LoginManagerClaims {
  let verified: string | jwt.JwtPayload;
  try {
    verified = jwt.verify(token, config.publicKey, {
      algorithms: ['RS256'],
      issuer: config.expectedIssuer,
      audience: config.expectedAudience,
    });
  } catch {
    throw new LoginManagerTokenError('Login Manager JWT verification failed');
  }
  if (typeof verified === 'string') {
    throw new LoginManagerTokenError('Login Manager JWT payload is invalid');
  }
  assertCommonClaims(verified);
  return verified;
}

export function verifyAccessToken(token: string, config: LoginManagerConfig): LoginManagerClaims {
  const claims = verifyCommon(token, config);
  if (
    claims.flow !== config.expectedFlow ||
    claims.type !== 'access' ||
    claims.token_use !== 'id'
  ) {
    throw new LoginManagerTokenError('Login Manager JWT has invalid flow or token type');
  }
  if (claims.email_verified !== true || typeof claims.email !== 'string' || !claims.email.trim()) {
    throw new LoginManagerTokenError('Login Manager JWT requires a verified email');
  }
  if (!claims['custom:users_id']?.trim() && !claims.sub?.trim()) {
    throw new LoginManagerTokenError('Login Manager JWT requires a stable user identifier');
  }
  return claims;
}

export function verifyRefreshToken(token: string, config: LoginManagerConfig): LoginManagerClaims {
  return verifyCommon(token, config);
}
