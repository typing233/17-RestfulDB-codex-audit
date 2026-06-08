import { Request } from 'express';
import { TransactionContext } from '../transaction';

export function txCtxFromRequest(req: Request): TransactionContext {
  return {
    role: req.dbRole,
    sub: req.jwtPayload?.sub as string | undefined,
    ip: req.ip || undefined,
    claims: req.jwtPayload || undefined,
  };
}
