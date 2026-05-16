export interface Env {
  NOCODB_API_TOKEN: string;
  NOCODB_BASE_URL: string;
  NOCODB_TABLE_ID: string;
  NOCODB_SOURCE_FIELD: string;
  NOCODB_SOURCE_VALUE: string;
  NOCODB_FIRST_REVIEW_FIELD: string;
  NOCODB_SECOND_REVIEW_FIELD: string;
  NOCODB_THIRD_REVIEW_FIELD: string;
  NOCODB_PAGE_SIZE?: string;
}

interface NocoDbListResponse {
  list?: NocoDbRecord[];
  pageInfo?: {
    totalRows?: number;
    page?: number;
    pageSize?: number;
    isFirstPage?: boolean;
    isLastPage?: boolean;
  };
}

type NocoDbRecord = Record<string, unknown>;

interface ReviewStat {
  checked: number;
  percentage: number;
}

interface RecentModifiedRow {
  id: string;
  modifiedBy: string;
  modifiedAt: string;
  reviews: {
    first: boolean;
    second: boolean;
    third: boolean;
  };
}

interface DashboardStats {
  generatedAt: string;
  source: string;
  totalSentences: number;
  reviews: {
    first: ReviewStat;
    second: ReviewStat;
    third: ReviewStat;
  };
  recentModifiedRows: RecentModifiedRow[];
}

const DEFAULT_PAGE_SIZE = 1000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    if (request.method !== 'GET' || url.pathname !== '/api/dashboard-stats') {
      return json({ error: 'Not found' }, 404);
    }

    try {
      assertConfig(env);

      const stats = await buildDashboardStats(env);
      return json(stats);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected dashboard error';
      const status = message.startsWith('Missing') ? 500 : 502;
      return json({ error: message }, status);
    }
  }
};

async function buildDashboardStats(env: Env): Promise<DashboardStats> {
  const rows = await fetchAllGeminiRows(env, env.NOCODB_SOURCE_FIELD, env.NOCODB_SOURCE_VALUE);

  const totalSentences = rows.length;
  const firstChecked = rows.filter((row) => isChecked(row[env.NOCODB_FIRST_REVIEW_FIELD])).length;
  const secondChecked = rows.filter((row) => isChecked(row[env.NOCODB_SECOND_REVIEW_FIELD])).length;
  const thirdChecked = rows.filter((row) => isChecked(row[env.NOCODB_THIRD_REVIEW_FIELD])).length;

  return {
    generatedAt: new Date().toISOString(),
    source: env.NOCODB_SOURCE_VALUE,
    totalSentences,
    reviews: {
      first: { checked: firstChecked, percentage: percentage(firstChecked, totalSentences) },
      second: { checked: secondChecked, percentage: percentage(secondChecked, totalSentences) },
      third: { checked: thirdChecked, percentage: percentage(thirdChecked, totalSentences) }
    },
    recentModifiedRows: buildRecentModifiedRows(rows, env)
  };
}

function buildRecentModifiedRows(rows: NocoDbRecord[], env: Env): RecentModifiedRow[] {
  return rows
    .map((row) => ({
      row,
      modifiedAt: readString(row['Last modified time']) || readString(row['UpdatedAt']) || readString(row['Created time'])
    }))
    .filter((entry): entry is { row: NocoDbRecord; modifiedAt: string } => Boolean(entry.modifiedAt))
    .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))
    .slice(0, 20)
    .map(({ row, modifiedAt }) => ({
      id: readString(row['Id']) || 'Unknown',
      modifiedBy: readString(row['Last modified by']) || 'Unknown',
      modifiedAt,
      reviews: {
        first: isChecked(row[env.NOCODB_FIRST_REVIEW_FIELD]),
        second: isChecked(row[env.NOCODB_SECOND_REVIEW_FIELD]),
        third: isChecked(row[env.NOCODB_THIRD_REVIEW_FIELD])
      }
    }));
}

async function fetchAllGeminiRows(env: Env, sourceField: string, sourceValue: string): Promise<NocoDbRecord[]> {
  const rows: NocoDbRecord[] = [];
  const pageSize = readPageSize(env.NOCODB_PAGE_SIZE);
  let offset = 0;

  while (true) {
    const page = await fetchNocoDbPage(env, sourceField, sourceValue, offset, pageSize);
    const list = Array.isArray(page.list) ? page.list : [];
    rows.push(...list);

    if (page.pageInfo?.isLastPage || list.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return rows;
}

async function fetchNocoDbPage(
  env: Env,
  sourceField: string,
  sourceValue: string,
  offset: number,
  limit: number
): Promise<NocoDbListResponse> {
  const apiUrl = env.NOCODB_BASE_URL.replace(/\/+$/, '');
  const url = new URL(`/api/v2/tables/${env.NOCODB_TABLE_ID}/records`, apiUrl);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('where', `(${sourceField},eq,${sourceValue})`);

  const response = await fetch(url, {
    headers: {
      'xc-token': env.NOCODB_API_TOKEN,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`NoCoDB request failed (${response.status}): ${body.slice(0, 240)}`);
  }

  return (await response.json()) as NocoDbListResponse;
}

function assertConfig(env: Env): void {
  const required: Array<keyof Env> = [
    'NOCODB_BASE_URL',
    'NOCODB_API_TOKEN',
    'NOCODB_TABLE_ID',
    'NOCODB_SOURCE_FIELD',
    'NOCODB_SOURCE_VALUE',
    'NOCODB_FIRST_REVIEW_FIELD',
    'NOCODB_SECOND_REVIEW_FIELD',
    'NOCODB_THIRD_REVIEW_FIELD'
  ];
  const missing = required.filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
}

function isChecked(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value > 0;
  }

  if (typeof value === 'string') {
    return ['true', 'yes', 'checked', '1', 'complete', 'completed'].includes(value.trim().toLowerCase());
  }

  return false;
}

function readString(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number') {
    return String(value);
  }

  return '';
}

function readPageSize(value: string | undefined): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(Math.trunc(parsed), 1000);
}

function percentage(count: number, total: number): number {
  return total === 0 ? 0 : Number(((count / total) * 100).toFixed(1));
}

function json(body: unknown, status = 200): Response {
  return withCors(
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      }
    })
  );
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET, OPTIONS');
  headers.set('access-control-allow-headers', 'content-type');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
