export type WateringErrorCode =
  | 'VALIDATION_FAILED'
  | 'PLANT_NOT_FOUND'
  | 'PLANT_NOT_ELIGIBLE'
  | 'EVENT_NOT_FOUND'
  | 'SCHEDULE_NOT_FOUND'
  | 'SCHEDULE_CONFLICT'
  | 'STALE_UPDATE'
  | 'ALREADY_VOIDED'
  | 'FUTURE_WATERING'
  | 'CONFLICT';

export type WateringFieldIssue = { field: string; message: string };

export class WateringError extends Error {
  readonly issues: readonly WateringFieldIssue[];

  constructor(
    readonly code: WateringErrorCode,
    message: string,
    options: ErrorOptions & { issues?: readonly WateringFieldIssue[] } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'WateringError';
    this.issues = options.issues ?? [];
  }
}
