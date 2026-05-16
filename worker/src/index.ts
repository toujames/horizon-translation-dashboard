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
  thadouSentence: string;
  englishSentence: string;
  modifiedBy: string;
  modifiedAt: string;
  reviews: {
    first: boolean;
    second: boolean;
    third: boolean;
  };
}

interface AssignmentUserSummary {
  assignee: string;
  total: number;
  assignments: AssignmentItem[];
}

interface AssignmentItem {
  id: string;
  assignedSentences: string;
  thadouSentence: string;
  englishSentence: string;
  status: string;
  dueDate: string;
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
  assignments: AssignmentUserSummary[];
}

const DEFAULT_PAGE_SIZE = 1000;
const ASSIGNMENTS_TABLE_ID = 'mhub16ztknqh5x6';

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
  const rows = await fetchAllRows(env, env.NOCODB_TABLE_ID, `(${env.NOCODB_SOURCE_FIELD},eq,${env.NOCODB_SOURCE_VALUE})`);
  const assignmentRows = await fetchAllRows(env, ASSIGNMENTS_TABLE_ID);

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
    recentModifiedRows: buildRecentModifiedRows(rows, env),
    assignments: buildAssignments(assignmentRows)
  };
}

function buildAssignments(rows: NocoDbRecord[]): AssignmentUserSummary[] {
  const grouped = new Map<string, AssignmentItem[]>();

  for (const row of rows) {
    if (isChecked(row['Done']) || isChecked(row['done'])) {
      continue;
    }

    const assignee = readFirstString(row, ['Assigned To', 'Assignee', 'User', 'Reviewer', 'Name', 'Email']);

    if (!assignee || assignee.toLowerCase() === 'null') {
      continue;
    }

    const item: AssignmentItem = {
      id: readString(row['Id']),
      assignedSentences: readFirstString(row, ['Assigned Sentences', 'Assigned Sentence', 'Sentence Range']),
      thadouSentence: readFirstString(row, ['Thadou Sentence', 'Sentence']),
      englishSentence: readFirstString(row, ['English Sentence', 'Translation']),
      status: readFirstString(row, ['Status', 'Progress', 'State']) || 'Assigned',
      dueDate: readFirstString(row, ['Due Date', 'Due', 'Deadline'])
    };

    grouped.set(assignee, [...(grouped.get(assignee) || []), item]);
  }

  return [...grouped.entries()]
    .map(([assignee, assignments]) => ({
      assignee,
      total: assignments.length,
      assignments: assignments.slice(0, 5)
    }))
    .sort((a, b) => b.total - a.total || a.assignee.localeCompare(b.assignee));
}

function buildRecentModifiedRows(rows: NocoDbRecord[], env: Env): RecentModifiedRow[] {
  return rows
    .map((row) => ({
      row,
      modifiedAt: readString(row['Last modified time']) || readString(row['UpdatedAt'])
    }))
    .filter((entry): entry is { row: NocoDbRecord; modifiedAt: string } => Boolean(entry.modifiedAt))
    .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))
    .slice(0, 20)
    .map(({ row, modifiedAt }) => ({
      id: readString(row['Id']),
      thadouSentence: readString(row['Thadou Sentence']),
      englishSentence: readString(row['English Sentence']),
      modifiedBy: readFirstString(row, ['Last modified by', 'Last Modified By', 'Updated by', 'UpdatedBy']) || 'No modifier recorded',
      modifiedAt,
      reviews: {
        first: isChecked(row[env.NOCODB_FIRST_REVIEW_FIELD]),
        second: isChecked(row[env.NOCODB_SECOND_REVIEW_FIELD]),
        third: isChecked(row[env.NOCODB_THIRD_REVIEW_FIELD])
      }
    }));
}

async function fetchAllRows(env: Env, tableId: string, where?: string): Promise<NocoDbRecord[]> {
  const rows: NocoDbRecord[] = [];
  const pageSize = readPageSize(env.NOCODB_PAGE_SIZE);
  let offset = 0;

  while (true) {
    const page = await fetchNocoDbPage(env, tableId, offset, pageSize, where);
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
  tableId: string,
  offset: number,
  limit: number,
  where?: string
): Promise<NocoDbListResponse> {
  const apiUrl = env.NOCODB_BASE_URL.replace(/\/+$/, '');
  const url = new URL(`/api/v2/tables/${tableId}/records`, apiUrl);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  if (where) {
    url.searchParams.set('where', where);
  }

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

  if (Array.isArray(value)) {
    return value.map((item) => readString(item)).filter(Boolean).join(', ');
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return (
      readString(record['displayValue']) ||
      readString(record['name']) ||
      readString(record['email']) ||
      readString(record['title'])
    );
  }

  return '';
}

function readFirstString(row: NocoDbRecord, keys: string[]): string {
  for (const key of keys) {
    const value = readString(row[key]);

    if (value) {
      return value;
    }
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
