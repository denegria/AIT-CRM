import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadSchemaManifest, verifyRepositoryBaseline } from './schema-readiness.mjs';

export const DRIZZLE_MUTATION_OPERATIONS = Object.freeze(['generate', 'migrate', 'push']);

const defaultRootDir = fileURLToPath(new URL('../../', import.meta.url));

function assertOperation(operation) {
  if (!DRIZZLE_MUTATION_OPERATIONS.includes(operation)) {
    throw new Error(`Unsupported Drizzle mutation operation ${JSON.stringify(operation)}.`);
  }
}

export function drizzleMutationBlockReason(manifest, operation) {
  assertOperation(operation);
  const policy = manifest.repository.drizzleMutation;
  if (policy?.allowed === true && !policy.blockedOperations?.includes(operation)) return '';
  return policy?.reason || `Drizzle ${operation} is not authorized by the reconciled schema baseline.`;
}

export async function preflightDrizzleMutation({
  operation,
  rootDir = defaultRootDir,
  manifest,
  verifyRepository = verifyRepositoryBaseline,
} = {}) {
  assertOperation(operation);
  const resolvedManifest = manifest || await loadSchemaManifest(rootDir);
  const report = await verifyRepository({ rootDir, manifest: resolvedManifest });
  const failed = report.checks.filter((check) => !check.ok);
  if (failed.length) {
    throw new Error(`Drizzle ${operation} blocked because the reconciled baseline is not intact: ${failed.map((check) => `${check.name}: ${check.detail}`).join('; ')}`);
  }

  const reason = drizzleMutationBlockReason(resolvedManifest, operation);
  if (reason) throw new Error(`Drizzle ${operation} blocked: ${reason}`);
  return { manifest: resolvedManifest, report };
}

function spawnDrizzle(rootDir, operation, extraArgs) {
  const executable = path.join(rootDir, 'node_modules', '.bin', 'drizzle-kit');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [operation, '--config', 'drizzle.config.mjs', ...extraArgs], {
      cwd: rootDir,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`drizzle-kit ${operation} exited with ${code ?? `signal ${signal}`}`));
    });
  });
}

export async function runGuardedDrizzleMutation({
  operation,
  extraArgs = [],
  rootDir = defaultRootDir,
  manifest,
  verifyRepository = verifyRepositoryBaseline,
  executeDrizzle = spawnDrizzle,
} = {}) {
  await preflightDrizzleMutation({ operation, rootDir, manifest, verifyRepository });
  await executeDrizzle(rootDir, operation, extraArgs);
}
