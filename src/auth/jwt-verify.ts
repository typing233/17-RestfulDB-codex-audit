import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Config } from '../config';
import { UnauthorizedError } from '../errors';

export interface JwtPayload {
  role?: string;
  sub?: string;
  [key: string]: unknown;
}

declare global {
  namespace Express {
    interface Request {
      jwtPayload?: JwtPayload;
      dbRole?: string;
    }
  }
}

export function createJwtMiddleware(config: Config['auth']) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!config.enabled) {
      req.dbRole = config.anonRole;
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.dbRole = config.anonRole;
      return next();
    }

    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, config.jwtSecret, {
        algorithms: [config.jwtAlgorithm as jwt.Algorithm],
      }) as JwtPayload;

      req.jwtPayload = decoded;
      req.dbRole = (decoded[config.roleClaim] as string) || config.anonRole;
      next();
    } catch {
      next(new UnauthorizedError('Invalid or expired token'));
    }
  };
}
