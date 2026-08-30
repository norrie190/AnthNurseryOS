export function formatPlantReference(value: bigint): string {
  if (typeof value !== 'bigint' || value < 1n) {
    throw new RangeError('A Plant reference requires a positive bigint sequence value.');
  }
  return `ANT-${value.toString().padStart(4, '0')}`;
}
