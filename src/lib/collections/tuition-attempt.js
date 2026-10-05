export function nextTuitionAttempt(current, businessUnitId, charge, createKey) {
  const signature = JSON.stringify([businessUnitId, charge]);
  return current?.signature === signature ? current : { signature, key: createKey() };
}
