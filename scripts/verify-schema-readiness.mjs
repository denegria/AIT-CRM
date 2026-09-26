import { verifyRepositoryBaseline } from './lib/schema-readiness.mjs';
import { verifyForwardSchemaRepository } from './lib/forward-schema.mjs';

const baseline = await verifyRepositoryBaseline({ verifyCurrentSchema: false });
const forward = await verifyForwardSchemaRepository();
const report = {
  ok: baseline.ok && forward.ok,
  checks: [...baseline.checks, ...forward.checks],
};

for (const check of report.checks) {
  console.log(`${check.ok ? 'ok' : 'fail'} ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
}
console.log(`schema manifest canonical sha256 - ${baseline.manifestSha256}`);
console.log(`forward schema manifest canonical sha256 - ${forward.manifestSha256}`);

if (!report.ok) {
  console.error('\nSchema readiness verification failed. Do not generate or apply migrations.');
  process.exit(1);
}

console.log('\nSchema readiness verification passed.');
