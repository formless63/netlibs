export type DocumentErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'VERSION_CONFLICT'
  | 'READ_ONLY'
  | 'UNSUPPORTED_SCHEMA';

export class DocumentError extends Error {
  readonly code: DocumentErrorCode;

  constructor(code: DocumentErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class DocumentNotFoundError extends DocumentError {
  constructor(message: string) {
    super('NOT_FOUND', message);
  }
}

export class DocumentValidationError extends DocumentError {
  constructor(message: string, options?: ErrorOptions) {
    super('VALIDATION', message, options);
  }
}

/** The stored version moved on since the caller read it. The React editor recognizes this code. */
export class DocumentConflictError extends DocumentError {
  constructor(message: string) {
    super('VERSION_CONFLICT', message);
  }
}

export class DocumentReadOnlyError extends DocumentError {
  constructor(message: string) {
    super('READ_ONLY', message);
  }
}

/** Content was written by a newer schema than this build understands. */
export class UnsupportedSchemaVersionError extends DocumentError {
  constructor(message: string) {
    super('UNSUPPORTED_SCHEMA', message);
  }
}
