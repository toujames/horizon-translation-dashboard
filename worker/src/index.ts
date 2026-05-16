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

interface ContributorStat {
  name: string;
  count: number;
  percentage: number;
}

interface DashboardStats {
  generatedAt: string;
  source: string;
  totalSentences: number;
  uniqueContributorCount: number;
  reviews: {
    first: ReviewStat;
    second: ReviewStat;
    third: ReviewStat;
  };
  contributors: ContributorStat[];
}

const DEFAULT_PAGE_SIZE = 1000;
const CONTRIBUTOR_FIELDS = ['Last modified by'];

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
  const contributorCounts = new Map<string, number>();

  for (const row of rows) {
    const rowContributors = new Set<string>();

    for (const field of CONTRIBUTOR_FIELDS) {
      for (const name of normalizeContributorValue(row[field])) {
        rowContributors.add(name);
      }
    }

    for (const name of rowContributors) {
      contributorCounts.set(name, (contributorCounts.get(name) || 0) + 1);
    }
  }

  const contributors = [...contributorCounts.entries()]
    .map(([name, count]) => ({
      name,
      count,
      percentage: percentage(count, totalSentences)
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 20);

  return {
    generatedAt: new Date().toISOString(),
    source: env.NOCODB_SOURCE_VALUE,
    totalSentences,
    uniqueContributorCount: contributorCounts.size,
    reviews: {
      first: { checked: firstChecked, percentage: percentage(firstChecked, totalSentences) },
      second: { checked: secondChecked, percentage: percentage(secondChecked, totalSentences) },
      third: { checked: thirdChecked, percentage: percentage(thirdChecked, totalSentences) }
    },
    contributors
  };
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

function normalizeContributorValue(value: unknown): string[] {
  if (typeof value === 'string') {
    const name = value.trim();
    return name ? [name] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeContributorValue(item));
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const candidate = record['displayValue'] || record['title'] || record['name'] || record['email'];
    return typeof candidate === 'string' && candidate.trim() ? [candidate.trim()] : [];
  }

  return [];
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
