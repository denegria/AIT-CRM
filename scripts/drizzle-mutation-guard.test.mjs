import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DRIZZLE_MUTATION_OPERATIONS,
  runGuardedDrizzleMutation,
} from './lib/drizzle-mutation-guard.mjs';
import { loadSchemaManifest } from './lib/schema-readiness.mjs';

const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url));
let manifest;

test.before(async () => {
  manifest = await loadSchemaManifest(ROOT_DIR);
});

function successfulRepositoryReport() {
  return { ok: true, checks: [{ name: 'fixture', ok: true, detail: '' }] };
}

function runNpmScript(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', script], {
      cwd: ROOT_DIR,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

test('generate, migrate, and push are blocked before the Drizzle executor', async () => {
  for (const operation of DRIZZLE_MUTATION_OPERATIONS) {
    let reachedDrizzle = false;
    await assert.rejects(
      () => runGuardedDrizzleMutation({
        operation,
        rootDir: ROOT_DIR,
        manifest,
        verifyRepository: async () => successfulRepositoryReport(),
        executeDrizzle: async () => {
          reachedDrizzle = true;
        },
      }),
      new RegExp(`Drizzle ${operation} blocked: .*metadata ends at 0012`),
    );
    assert.equal(reachedDrizzle, false, `${operation} reached Drizzle`);
  }
});

test('altered repository inputs stop before both policy evaluation and Drizzle', async () => {
  let reachedDrizzle = false;
  await assert.rejects(
    () => runGuardedDrizzleMutation({
      operation: 'migrate',
      rootDir: ROOT_DIR,
      manifest,
      verifyRepository: async () => ({
        ok: false,
        checks: [{ name: 'migration bytes', ok: false, detail: '0015 sha256 altered' }],
      }),
      executeDrizzle: async () => {
        reachedDrizzle = true;
      },
    }),
    /baseline is not intact.*0015 sha256 altered/,
  );
  assert.equal(reachedDrizzle, false);
});

test('npm db:migrate and db:push exit in the guard without invoking drizzle-kit', async () => {
  for (const operation of ['migrate', 'push']) {
    const result = await runNpmScript(`db:${operation}`);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.code, 1, output);
    assert.match(output, new RegExp(`Drizzle ${operation} blocked:`));
    assert.doesNotMatch(output, new RegExp(`drizzle-kit ${operation}`));
  }
});
