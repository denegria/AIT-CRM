import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const errors = [];
const requireCondition = (condition, message) => { if (!condition) errors.push(message); };
for (const file of ["AGENTS.md", ".github/workflows/validate.yml", ".github/pull_request_template.md", "docs/release-packet-template.md"]) {
  requireCondition(existsSync(file), `missing ${file}`);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
for (const script of ["test", "check:repository", "validate", "lint", "build"]) {
  requireCondition(Boolean(packageJson.scripts?.[script]), `missing npm script ${script}`);
}
const contract = readFileSync("AGENTS.md", "utf8");
for (const phrase of ["Next.js 16", "npm run validate", "explicit Alvaro approval", "Sentry", "business-unit"]) {
  requireCondition(contract.includes(phrase), `AGENTS.md must include ${phrase}`);
}
const packet = readFileSync("docs/release-packet-template.md", "utf8");
for (const field of ["Issue", "Brief/reference", "Candidate commit", "Validation", "Browser evidence", "Deployment URL", "Sentry status", "Approval state"]) {
  requireCondition(packet.includes(field), `release packet missing ${field}`);
}
const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n");
const sensitive = tracked.filter((file) => /(^|\/)\.env($|\.)/.test(file) && !file.endsWith(".example"));
requireCondition(sensitive.length === 0, `tracked environment files: ${sensitive.join(", ")}`);

if (errors.length) {
  for (const error of errors) console.error(`repository check failed: ${error}`);
  process.exit(1);
}
console.log("repository contract passed");
