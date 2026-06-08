export abstract class AppError extends Error {
  abstract statusCode: number;
  abstract code: string;
  details?: unknown;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends AppError {
  statusCode = 404;
  code = 'NOT_FOUND';
}

export class ValidationError extends AppError {
  statusCode = 400;
  code = 'VALIDATION_ERROR';

  constructor(message: string, public details?: { field: string; issue: string }[]) {
    super(message);
  }
}

export class ConflictError extends AppError {
  statusCode = 409;
  code = 'CONFLICT';
}

export class UnauthorizedError extends AppError {
  statusCode = 401;
  code = 'UNAUTHORIZED';
}

export class ForbiddenError extends AppError {
  statusCode = 403;
  code = 'FORBIDDEN';
}

export class InternalError extends AppError {
  statusCode = 500;
  code = 'INTERNAL_ERROR';
}

interface PgError {
  code?: string;
  detail?: string;
  column?: string;
  constraint?: string;
}

export function translatePgError(err: PgError): AppError {
  switch (err.code) {
    case '23505':
      return new ConflictError(`Duplicate value: ${err.detail || err.constraint}`);
    case '23503':
      return new ValidationError(`Referenced record does not exist: ${err.detail || err.constraint}`);
    case '23502':
      return new ValidationError(`Missing required field: ${err.column}`);
    case '42501':
      return new ForbiddenError('Access denied by row-level security policy');
    default:
      return new InternalError('Database error');
  }
}
