import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../errors';

const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

export function inputValidator(req: Request, _res: Response, next: NextFunction) {
  const query = req.query as Record<string, string>;

  if (query.select) {
    const cols = query.select.split(',').map(s => s.trim());
    for (const col of cols) {
      if (!SAFE_IDENTIFIER.test(col)) {
        return next(new ValidationError(`Invalid column name in select: ${col}`));
      }
    }
  }

  if (query.order) {
    const parts = query.order.split(',').map(s => s.trim());
    for (const part of parts) {
      const [col] = part.split('.');
      if (!SAFE_IDENTIFIER.test(col)) {
        return next(new ValidationError(`Invalid column name in order: ${col}`));
      }
    }
  }

  if (query.embed) {
    const parts = query.embed.split(',').map(s => s.trim());
    for (const part of parts) {
      const segments = part.split('.');
      for (const seg of segments) {
        if (!SAFE_IDENTIFIER.test(seg)) {
          return next(new ValidationError(`Invalid relation name in embed: ${seg}`));
        }
      }
    }
  }

  next();
}
