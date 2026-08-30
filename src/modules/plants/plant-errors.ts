export type PlantErrorCode =
  'VALIDATION_FAILED' | 'INVALID_PARENT' | 'LOCATION_UNAVAILABLE' | 'CONFLICT';

export type PlantFieldIssue = { field: string; message: string };

export class PlantError extends Error {
  readonly code: PlantErrorCode;
  readonly issues: readonly PlantFieldIssue[];

  constructor(
    code: PlantErrorCode,
    message: string,
    options: ErrorOptions & { issues?: readonly PlantFieldIssue[] } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'PlantError';
    this.code = code;
    this.issues = options.issues ?? [];
  }
}
