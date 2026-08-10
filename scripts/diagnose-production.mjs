import { runProductionDiagnostics } from './verify-production-readiness.mjs';

if (process.argv.includes('--help')) {
  console.log('Runs non-authoritative repository and production HTTP diagnostics only. It does not prove production readiness because no live database identity or catalog check is performed.');
  process.exit(0);
}

try {
  const report = await runProductionDiagnostics();
  if (!report.ok) {
    console.error(`\n${report.checks.filter((check) => !check.ok).length} production diagnostic check(s) failed. Production readiness was not evaluated.`);
    process.exitCode = 1;
  } else {
    console.log('\nNon-authoritative production diagnostics passed. Live database identity/catalog proof was not run; production readiness is not established.');
  }
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
