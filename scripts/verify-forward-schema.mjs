import { verifyForwardSchemaRepository } from './lib/forward-schema.mjs';

const report = await verifyForwardSchemaRepository();
for (const check of report.checks) {
  console.log(`${check.ok ? 'ok' : 'fail'} ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
}
console.log(`forward schema manifest canonical sha256 - ${report.manifestSha256}`);
if (!report.ok) process.exitCode = 1;
