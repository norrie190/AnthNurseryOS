export function formatEquipmentReference(value: bigint): string {
  if (typeof value !== 'bigint' || value < 1n) {
    throw new Error('An Equipment reference requires a positive bigint allocation.');
  }
  return `EQP-${value.toString().padStart(4, '0')}`;
}
