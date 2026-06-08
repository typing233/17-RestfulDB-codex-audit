import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { AppError } from '../errors';
import logger from '../logger';

export const errorHandler: ErrorRequestHandler = (err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? undefined,
      },
    });
  } else {
    logger.error({ err, method: req.method, path: req.path }, 'Unhandled error');
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  }
};
