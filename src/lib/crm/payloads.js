export function toBusinessUnitPayload(row, { emptyColor = '' } = {}) {
  return {
    id: row.id,
    name: row.name,
    label: row.label || 'Divisions',
    color: row.color || emptyColor,
    isActive: row.isActive !== false,
  };
}
