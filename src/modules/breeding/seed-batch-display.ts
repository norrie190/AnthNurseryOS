export function formatSeedCount(seedCount: number | null): string {
  if (seedCount === null) return 'Seed count unknown';
  if (seedCount === 0) return '0 seeds recorded';
  return `${seedCount} ${seedCount === 1 ? 'seed' : 'seeds'}`;
}

export function formatGerminationProgress(
  germinatedCount: number | null,
  seedCount: number | null,
): string {
  if (germinatedCount === null) return 'Germination not counted';
  if (seedCount === 0) return `${germinatedCount} germinated · 0 seeds recorded`;
  if (seedCount !== null && seedCount > 0) return `${germinatedCount} of ${seedCount} germinated`;
  return `${germinatedCount} germinated · total seed count unknown`;
}

export function germinationPercentage(
  germinatedCount: number | null,
  seedCount: number | null,
): number | null {
  if (germinatedCount === null || seedCount === null || seedCount <= 0) return null;
  return (germinatedCount / seedCount) * 100;
}
