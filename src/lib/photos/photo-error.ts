// Expected image/crop validation failures only. Domain services own other errors.
export class PhotoValidationError extends Error {
  readonly issues: readonly { field: string; message: string }[];
  constructor(
    message: string,
    options: ErrorOptions & { issues: readonly { field: string; message: string }[] },
  ) {
    super(message, { cause: options.cause });
    this.name = 'PhotoValidationError';
    this.issues = options.issues;
  }
}
