export type ViewerErrorCode =
  /** The bytes could not be requested at all (network, CORS, adapter threw). */
  | 'fetch-failed'
  /** The server answered, but not with a 2xx. */
  | 'http-status'
  /** The bytes exceed a configured ceiling. */
  | 'too-large'
  /** The bytes arrived but are not a file this viewer understands. */
  | 'parse-failed'
  /** The rendering engine (a lazy chunk, a WebGL context, …) could not start. */
  | 'engine-failed'
  /** No registered viewer handles this file. */
  | 'unsupported'
  /** The viewer threw while rendering. */
  | 'render-failed';

export class ViewerError extends Error {
  override readonly name = 'ViewerError';
  readonly code: ViewerErrorCode;
  readonly status: number | undefined;

  constructor(
    code: ViewerErrorCode,
    message: string,
    options?: { cause?: unknown; status?: number },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.status = options?.status;
  }
}

/** Wrap any thrown value, preserving an existing `ViewerError`'s own code. */
export function toViewerError(error: unknown, fallback: ViewerErrorCode): ViewerError {
  if (error instanceof ViewerError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ViewerError(fallback, message, { cause: error });
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
