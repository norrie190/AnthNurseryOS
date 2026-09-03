export type BreedingErrorCode =
  | 'VALIDATION_FAILED'
  | 'PLANT_NOT_FOUND'
  | 'PLANT_NOT_ELIGIBLE'
  | 'INFLORESCENCE_NOT_FOUND'
  | 'INFLORESCENCE_NOT_OWNED'
  | 'INFLORESCENCE_VOIDED'
  | 'INFLORESCENCE_NOT_POLLINATABLE'
  | 'INVALID_STATUS_TRANSITION'
  | 'STALE_UPDATE'
  | 'POLLINATION_ATTEMPT_NOT_FOUND'
  | 'POLLINATION_ATTEMPT_NOT_OWNED'
  | 'POLLINATION_ATTEMPT_EXISTS'
  | 'POLLINATION_ATTEMPT_VOIDED'
  | 'POLLEN_PLANT_NOT_FOUND'
  | 'CONFLICT'
  | 'SEED_BATCH_PROVENANCE';

export type BreedingFieldIssue = { field: string; message: string };

export class BreedingError extends Error {
  readonly issues: readonly BreedingFieldIssue[];

  constructor(
    readonly code: BreedingErrorCode,
    message: string,
    options: ErrorOptions & { issues?: readonly BreedingFieldIssue[] } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'BreedingError';
    this.issues = options.issues ?? [];
  }
}
