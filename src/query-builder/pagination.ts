import { Config } from '../config';

export interface PaginationParams {
  limit: number;
  offset: number;
}

export type CountStrategy = 'exact' | 'planned' | 'estimated';

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

export function parseCountStrategy(preferHeader: string | undefined): CountStrategy {
  if (!preferHeader) return 'exact';
  const match = preferHeader.match(/count=(exact|planned|estimated)/);
  return (match?.[1] as CountStrategy) || 'exact';
}
