import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

interface NocoDbListResponse {
  list?: NocoDbRecord[];
  pageInfo?: {
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

const outputPath = resolve('apps/dashboard/public/dashboard-stats.json');
const pageSize = 1000;
const assignmentsTableId = 'mhub16ztknqh5x6';

loadLocalEnvFiles();

const config = {
  baseUrl: requireEnv('NOCODB_BASE_URL'),
  apiToken: requireEnv('NOCODB_API_TOKEN'),
  tableId: requireEnv('NOCODB_TABLE_ID'),
  sourceField: requireEnv('NOCODB_SOURCE_FIELD'),
  sourceValue: requireEnv('NOCODB_SOURCE_VALUE'),
  firstReviewField: requireEnv('NOCODB_FIRST_REVIEW_FIELD'),
  secondReviewField: requireEnv('NOCODB_SECOND_REVIEW_FIELD'),
  thirdReviewField: requireEnv('NOCODB_THIRD_REVIEW_FIELD')
};

const rows = await fetchAllRows(config.tableId, `(${config.sourceField},eq,${config.sourceValue})`);
const assignmentRows = await fetchAllRows(assignmentsTableId);
const stats = buildStats(rows, assignmentRows);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');

console.log(`Wrote ${outputPath} with ${stats.totalSentences} summarized Gemini rows.`);

async function fetchAllRows(tableId: string, where?: string): Promise<NocoDbRecord[]> {
  const rows: NocoDbRecord[] = [];
  let offset = 0;

  while (true) {
    const page = await fetchPage(tableId, offset, where);
    const list = Array.isArray(page.list) ? page.list : [];
    rows.push(...list);

    if (page.pageInfo?.isLastPage || list.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return rows;
}

async function fetchPage(tableId: string, offset: number, where?: string): Promise<NocoDbListResponse> {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const url = new URL(`/api/v2/tables/${tableId}/records`, baseUrl);
  url.searchParams.set('limit', String(pageSize));
  url.searchParams.set('offset', String(offset));

  if (where) {
    url.searchParams.set('where', where);
  }

  const response = await fetch(url, {
    headers: {
      'xc-token': config.apiToken,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`NoCoDB request failed (${response.status}): ${body.slice(0, 240)}`);
  }

  return (await response.json()) as NocoDbListResponse;
}

function buildStats(rows: NocoDbRecord[], assignmentRows: NocoDbRecord[]): DashboardStats {
  const totalSentences = rows.length;
  const firstChecked = rows.filter((row) => isChecked(row[config.firstReviewField])).length;
  const secondChecked = rows.filter((row) => isChecked(row[config.secondReviewField])).length;
  const thirdChecked = rows.filter((row) => isChecked(row[config.thirdReviewField])).length;

  return {
    generatedAt: new Date().toISOString(),
    source: config.sourceValue,
    totalSentences,
    reviews: {
      first: { checked: firstChecked, percentage: percentage(firstChecked, totalSentences) },
      second: { checked: secondChecked, percentage: percentage(secondChecked, totalSentences) },
      third: { checked: thirdChecked, percentage: percentage(thirdChecked, totalSentences) }
    },
    recentModifiedRows: buildRecentModifiedRows(rows),
    assignments: buildAssignments(assignmentRows)
  };
}

function buildAssignments(rows: NocoDbRecord[]): AssignmentUserSummary[] {
  const grouped = new Map<string, AssignmentItem[]>();

  for (const row of rows) {
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
      assignments: assignments.slice(0, 12)
    }))
    .sort((a, b) => b.total - a.total || a.assignee.localeCompare(b.assignee));
}

function buildRecentModifiedRows(rows: NocoDbRecord[]): RecentModifiedRow[] {
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
        first: isChecked(row[config.firstReviewField]),
        second: isChecked(row[config.secondReviewField]),
        third: isChecked(row[config.thirdReviewField])
      }
    }));
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

function percentage(count: number, total: number): number {
  return total === 0 ? 0 : Number(((count / total) * 100).toFixed(1));
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function loadLocalEnvFiles(): void {
  for (const fileName of ['.env.local', '.env']) {
    const filePath = resolve(fileName);

    if (!existsSync(filePath)) {
      continue;
    }

    const content = readFileSync(filePath, 'utf8');

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const equalsIndex = trimmed.indexOf('=');

      if (equalsIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, equalsIndex).trim();

      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key]) {
        continue;
      }

      process.env[key] = stripEnvQuotes(trimmed.slice(equalsIndex + 1).trim());
    }
  }
}

function stripEnvQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
