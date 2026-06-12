export function validateManualContactIdentity(input = {}) {
  const name = String(input.name || '').trim();
  const email = String(input.email || '').trim();
  const phone = String(input.phone || '').trim();

  if (!name) return 'Contact name is required.';
  if (!email && !phone) return 'Add either a phone number or an email address.';
  return '';
}
