import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const roots = ["scripts", "src"];
const excluded = new Set([
  "src/app/tasks/follow-up-route-validation.test.js",
  "src/components/FollowUpOutcomeDialog.test.jsx",
]);
const testPattern = /\.test\.(?:js|mjs)$/;

function collect(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const candidate = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) return collect(candidate);
      return testPattern.test(candidate) && !excluded.has(candidate) ? [candidate] : [];
    });
}

const files = roots.flatMap(collect).sort();
if (!files.length) throw new Error("No tests discovered.");
console.log(`running ${files.length} standard test files; TSX/route-hook tests run in test:follow-up-outcome`);
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
