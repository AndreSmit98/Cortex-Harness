import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { MongoMemoryServer } from 'mongodb-memory-server';

const port = 5174;
const databaseDirectory = resolve(process.cwd(), 'data-node', 'standalone');
await mkdir(databaseDirectory, { recursive: true });

const secretsPath = resolve(databaseDirectory, 'runtime-secrets.json');
const createRuntimeSecrets = () => ({
  credsKey: randomBytes(32).toString('hex'),
  credsIv: randomBytes(16).toString('hex'),
  jwtSecret: randomBytes(32).toString('hex'),
  jwtRefreshSecret: randomBytes(32).toString('hex'),
});

let runtimeSecrets;
try {
  runtimeSecrets = JSON.parse(await readFile(secretsPath, 'utf8'));
} catch {
  runtimeSecrets = createRuntimeSecrets();
  await writeFile(secretsPath, `${JSON.stringify(runtimeSecrets, null, 2)}\n`, { mode: 0o600 });
}

const mongo = await MongoMemoryServer.create({
  instance: {
    dbName: 'LibreChat',
    port: 27018,
    dbPath: databaseDirectory,
  },
});

const localUrl = `http://localhost:${port}`;
const child = spawn(process.execPath, ['api/server/index.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    MONGO_URI: mongo.getUri('LibreChat'),
    DOMAIN_CLIENT: localUrl,
    DOMAIN_SERVER: localUrl,
    OPENAI_API_KEY: 'user_provided',
    CREDS_KEY: runtimeSecrets.credsKey,
    CREDS_IV: runtimeSecrets.credsIv,
    JWT_SECRET: runtimeSecrets.jwtSecret,
    JWT_REFRESH_SECRET: runtimeSecrets.jwtRefreshSecret,
    ALLOW_EMAIL_LOGIN: 'true',
    ALLOW_REGISTRATION: 'true',
    ALLOW_SOCIAL_LOGIN: 'false',
    ALLOW_SOCIAL_REGISTRATION: 'false',
    ALLOW_UNVERIFIED_EMAIL_LOGIN: 'true',
    SEARCH: 'false',
    NO_INDEX: 'true',
    DEBUG_LOGGING: 'false',
    LOG_TO_FILE: 'false',
  },
  stdio: 'inherit',
});

const stop = async () => {
  child.kill('SIGTERM');
  await mongo.stop({ doCleanup: false });
  process.exit(0);
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', async (code) => {
  await mongo.stop({ doCleanup: false });
  process.exit(code ?? 1);
});
