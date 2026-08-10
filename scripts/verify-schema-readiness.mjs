import { verifyRepositoryBaseline } from './lib/schema-readiness.mjs';

const report = await verifyRepositoryBaseline();

for (const check of report.checks) {
  console.log(`${check.ok ? 'ok' : 'fail'} ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
}
console.log(`schema manifest canonical sha256 - ${report.manifestSha256}`);

if (!report.ok) {
  console.error('\nSchema readiness verification failed. Do not generate or apply migrations.');
  process.exit(1);
}

console.log('\nSchema readiness verification passed.');
