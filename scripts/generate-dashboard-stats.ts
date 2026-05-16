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

const outputPath = resolve('apps/dashboard/public/dashboard-stats.json');
const pageSize = 1000;
const contributorFields = ['Last modified by'];

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

const rows = await fetchAllRows();
const stats = buildStats(rows);

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');

console.log(`Wrote ${outputPath} with ${stats.totalSentences} summarized Gemini rows.`);

async function fetchAllRows(): Promise<NocoDbRecord[]> {
  const rows: NocoDbRecord[] = [];
  let offset = 0;

  while (true) {
    const page = await fetchPage(offset);
    const list = Array.isArray(page.list) ? page.list : [];
    rows.push(...list);

    if (page.pageInfo?.isLastPage || list.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return rows;
}

async function fetchPage(offset: number): Promise<NocoDbListResponse> {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const url = new URL(`/api/v2/tables/${config.tableId}/records`, baseUrl);
  url.searchParams.set('limit', String(pageSize));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('where', `(${config.sourceField},eq,${config.sourceValue})`);

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

function buildStats(rows: NocoDbRecord[]): DashboardStats {
  const totalSentences = rows.length;
  const firstChecked = rows.filter((row) => isChecked(row[config.firstReviewField])).length;
  const secondChecked = rows.filter((row) => isChecked(row[config.secondReviewField])).length;
  const thirdChecked = rows.filter((row) => isChecked(row[config.thirdReviewField])).length;
  const contributorCounts = new Map<string, number>();

  for (const row of rows) {
    const rowContributors = new Set<string>();

    for (const field of contributorFields) {
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
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    generatedAt: new Date().toISOString(),
    source: config.sourceValue,
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
