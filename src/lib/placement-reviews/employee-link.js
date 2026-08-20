const EMPLOYEE_REVIEW_PATH = '/employee/placement-reviews';
const OPAQUE_REVIEW_ID = /^[A-Za-z0-9._:-]{1,160}$/;

// This runs only in the server task-detail loader. It deliberately accepts one
// fixed employee route and one opaque query value so task metadata can never
// turn into an arbitrary external link.
export function resolveAitUsaEmployeeReviewUrl({ employeeBaseUrl, employeeUrl } = {}) {
  if (typeof employeeBaseUrl !== 'string' || typeof employeeUrl !== 'string') return null;
  let base;
  let target;
  try {
    base = new URL(employeeBaseUrl);
    target = new URL(employeeUrl, base.origin);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' || !base.hostname || base.username || base.password || base.search || base.hash) return null;
  if (target.origin !== base.origin || target.pathname !== EMPLOYEE_REVIEW_PATH || target.hash) return null;
  const entries = [...target.searchParams.entries()];
  if (entries.length !== 1 || entries[0][0] !== 'review' || !OPAQUE_REVIEW_ID.test(entries[0][1])) return null;
  const expectedPath = `${EMPLOYEE_REVIEW_PATH}?review=${encodeURIComponent(entries[0][1])}`;
  if (employeeUrl !== expectedPath) return null;
  return `${base.origin}${expectedPath}`;
}
