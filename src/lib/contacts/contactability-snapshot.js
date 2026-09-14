export function contactabilitySnapshot(contact = {}) {
  return {
    id: contact.id || '',
    email: contact.email || '',
    phone: contact.phone || '',
    isDoNotCall: Boolean(contact.isDoNotCall),
    isWrongNumber: Boolean(contact.isWrongNumber),
    updatedAt: contact.updatedAt?.toISOString?.() || contact.updatedAt || '',
  };
}
