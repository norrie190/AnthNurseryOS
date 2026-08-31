export type EnergyErrorCode =
  'VALIDATION_FAILED' | 'NOT_FOUND' | 'STALE_UPDATE' | 'OVERLAP' | 'POWER_UNAVAILABLE' | 'CONFLICT';

export class EnergyError extends Error {
  readonly issues: readonly { field: string; message: string }[];
  constructor(
    readonly code: EnergyErrorCode,
    message: string,
    options: ErrorOptions & { issues?: readonly { field: string; message: string }[] } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'EnergyError';
    this.issues = options.issues ?? [];
  }
}
