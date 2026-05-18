export function toBusinessUnitPayload(row) {
  return {
    id: row.id,
    name: row.name,
    label: row.label || 'Divisions',
    color: row.color || '',
    isActive: row.isActive !== false,
  };
}
