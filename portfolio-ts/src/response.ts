export interface PaginationMeta {
  limit: number;
  offset: number;
  total: number;
  has_more: boolean;
  next_offset: number | null;
}

export interface SuccessEnvelope {
  ok: true;
  command: string;
  data: unknown;
  meta: {
    generated_at: string;
    count: number | null;
    pagination?: PaginationMeta;
    [key: string]: unknown;
  };
}

export interface ErrorEnvelope {
  ok: false;
  command: string;
  error: {
    code: string;
    message: string;
  };
  meta: {
    generated_at: string;
    count: null;
  };
}

export type Envelope = SuccessEnvelope | ErrorEnvelope;

export function nowUtc(): string {
  return new Date().toISOString();
}

export function success(
  command: string,
  data: unknown,
  count: number | null = null,
  pagination?: PaginationMeta,
  extraMeta?: Record<string, unknown>,
): SuccessEnvelope {
  const meta: Record<string, unknown> = { generated_at: nowUtc(), count };
  if (pagination) meta.pagination = pagination;
  if (extraMeta) Object.assign(meta, extraMeta);
  return { ok: true, command, data, meta: meta as SuccessEnvelope["meta"] };
}

export function error(
  command: string,
  code: string,
  message: string,
): ErrorEnvelope {
  return {
    ok: false,
    command,
    error: { code, message },
    meta: { generated_at: nowUtc(), count: null },
  };
}

export function buildPagination(
  limit: number,
  offset: number,
  total: number,
): PaginationMeta {
  const hasMore = offset + limit < total;
  return {
    limit,
    offset,
    total,
    has_more: hasMore,
    next_offset: hasMore ? offset + limit : null,
  };
}
