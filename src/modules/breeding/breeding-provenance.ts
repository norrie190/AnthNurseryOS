type PlantIdentity = { reference: string };
type CrossAttempt = {
  pollenSourceMode: 'INTERNAL' | 'EXTERNAL' | 'UNKNOWN';
  pollenParent?: PlantIdentity | null;
  pollenParentName?: string | null;
};

export function formatBreedingCross(seedParent: PlantIdentity, attempt: CrossAttempt): string {
  const pollen =
    attempt.pollenSourceMode === 'INTERNAL'
      ? (attempt.pollenParent?.reference ?? 'Unknown pollen')
      : attempt.pollenSourceMode === 'EXTERNAL'
        ? `External ${attempt.pollenParentName?.trim() || 'Parent Label'}`
        : 'Unknown pollen';
  return `${seedParent.reference} × ${pollen}`;
}
