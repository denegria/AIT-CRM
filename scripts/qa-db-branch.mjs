#!/usr/bin/env node

import {
  attachQaBranch,
  createQaBranch,
  destroyQaBranch,
  listExpiredQaBranches,
  readQaBranchStatus,
  verifyQaBranch,
} from './lib/qa-db-branch-workflow.mjs';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument ${token}.`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (['execute', 'databaseOnly', 'branchAlreadyExpired'].includes(key)) {
      options[key] = true;
      continue;
    }
    const value = rest[index + 1];
    if (value == null || value.startsWith('--')) throw new Error(`${token} requires a value.`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function usage() {
  return `AIT CRM production-derived QA database workflow

Dry-run is the default for create, attach, and destroy. Add --execute to mutate external state.

Commands:
  create  --issue MIS-123 --owner NAME --purpose TEXT --preview-branch BRANCH
          --project-id PROJECT --parent-branch PRODUCTION_BRANCH_ID
          --protected-branch-ids PRODUCTION_ID,STAGING_ID [--ttl-hours 24] [--execute]
  attach  --manifest-path PATH [--vercel-project PROJECT] [--execute]
  verify  --manifest-path PATH [--database-only]
  status  --manifest-path PATH
  expired [--root-dir PATH]
  destroy --manifest-path PATH --confirm-branch EXACT_NAME [--branch-already-expired] [--execute]

Environment fallbacks for create:
  NEON_PROJECT_ID
  AIT_CRM_PRODUCTION_NEON_BRANCH_ID
  AIT_CRM_PROTECTED_NEON_BRANCH_IDS
`;
}

function withEnvironment(options) {
  return {
    ...options,
    projectId: options.projectId || process.env.NEON_PROJECT_ID,
    parentBranch: options.parentBranch || process.env.AIT_CRM_PRODUCTION_NEON_BRANCH_ID,
    protectedBranchIds: options.protectedBranchIds || process.env.AIT_CRM_PROTECTED_NEON_BRANCH_IDS,
  };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  let result;
  if (command === 'create') result = await createQaBranch(withEnvironment(options));
  else if (command === 'attach') result = await attachQaBranch(options);
  else if (command === 'verify') result = await verifyQaBranch(options);
  else if (command === 'status') result = await readQaBranchStatus(options);
  else if (command === 'expired') result = await listExpiredQaBranches(options);
  else if (command === 'destroy') result = await destroyQaBranch(options);
  else {
    console.log(usage());
    if (command) process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
