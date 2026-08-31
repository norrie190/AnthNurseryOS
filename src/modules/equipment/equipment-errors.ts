export type EquipmentErrorCode =
  'VALIDATION_FAILED' | 'LOCATION_UNAVAILABLE' | 'NOT_FOUND' | 'STALE_UPDATE' | 'CONFLICT';

export class EquipmentError extends Error {
  readonly code: EquipmentErrorCode;
  readonly issues: readonly { field: string; message: string }[];

  constructor(
    code: EquipmentErrorCode,
    message: string,
    options: ErrorOptions & { issues?: readonly { field: string; message: string }[] } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'EquipmentError';
    this.code = code;
    this.issues = options.issues ?? [];
  }
}
