// Domain-level errors raised by the Drive-backed feature services.
//
// These mirror the HTTP problem responses the old API returned (400/404/409)
// so the UI can show the same messages. `code` carries the few special cases
// (e.g. an in-use category) the UI branches on.

export class DriveRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'DriveRequestError';
  }
}

export const badRequest = (message: string): DriveRequestError => new DriveRequestError(400, message);

export const notFound = (message = 'Not found.'): DriveRequestError => new DriveRequestError(404, message);

export const conflict = (message: string, code?: string): DriveRequestError =>
  new DriveRequestError(409, message, code);
