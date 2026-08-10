import { runGuardedDrizzleMutation } from './lib/drizzle-mutation-guard.mjs';

const operation = process.argv[2];
const extraArgs = process.argv.slice(3);

try {
  await runGuardedDrizzleMutation({ operation, extraArgs });
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
