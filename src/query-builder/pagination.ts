import { Config } from '../config';

export interface PaginationParams {
  limit: number;
  offset: number;
}

export function parsePagination(
  query: { limit?: string; offset?: string },
  config: Config['pagination'],
): PaginationParams {
  let limit = config.defaultLimit;
  let offset = 0;

  if (query.limit !== undefined) {
    limit = Math.min(parseInt(query.limit, 10) || config.defaultLimit, config.maxLimit);
  }
  if (query.offset !== undefined) {
    offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  }

  return { limit, offset };
}
