import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { catchError, interval, of, startWith, switchMap, tap } from 'rxjs';

import { environment } from './environments/environment';

type NocoDbRecord = Record<string, unknown>;

interface NocoDbListResponse {
  list?: NocoDbRecord[];
  pageInfo?: {
    isLastPage?: boolean;
  };
}

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

const emptyStats: DashboardStats = {
  generatedAt: '',
  source: 'gemini',
  totalSentences: 0,
  reviews: {
    first: { checked: 0, percentage: 0 },
    second: { checked: 0, percentage: 0 },
    third: { checked: 0, percentage: 0 }
  },
  recentModifiedRows: [],
  assignments: []
};

const nocoDbBaseUrl = 'https://nocodb.horizon.kukiinpi.us';
const sentenceTableId = 'mf28g2tn6zzdo3e';
const assignmentsTableId = 'mhub16ztknqh5x6';
const pageSize = 1000;
const sourceField = 'Source';
const sourceValue = 'gemini';
const firstReviewField = '1st Review';
const secondReviewField = '2nd Review';
const thirdReviewField = '3rd Review';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DatePipe, DecimalPipe],
  template: `
    <main class="dashboard-shell">
      <header class="dashboard-header">
        <div>
          <p class="eyebrow">Translation Review</p>
          <h1>Project Horizon Sentence Status</h1>
        </div>
        <div class="refresh-panel">
          <span>Auto-refresh</span>
          <strong>60s</strong>
          @if (lastUpdated()) {
            <small>Updated {{ lastUpdated() | date:'shortTime' }}</small>
          }
        </div>
      </header>

      @if (errorMessage()) {
        <section class="error-banner" role="alert">{{ errorMessage() }}</section>
      }

      <section class="summary-grid" aria-label="Dashboard summary">
        <article class="metric-card primary">
          <span class="metric-label">Total sentences</span>
          <strong class="metric-value">{{ stats().totalSentences | number }}</strong>
          <span class="metric-footnote">Source = {{ stats().source }}</span>
        </article>

        <article class="metric-card">
          <span class="metric-label">1st review</span>
          <strong class="metric-value">{{ stats().reviews.first.checked | number }}</strong>
          <div class="progress-track" aria-hidden="true">
            <span [style.width.%]="stats().reviews.first.percentage"></span>
          </div>
          <span class="metric-footnote">{{ stats().reviews.first.percentage | number:'1.0-1' }}% checked</span>
        </article>

        <article class="metric-card">
          <span class="metric-label">2nd review</span>
          <strong class="metric-value">{{ stats().reviews.second.checked | number }}</strong>
          <div class="progress-track" aria-hidden="true">
            <span [style.width.%]="stats().reviews.second.percentage"></span>
          </div>
          <span class="metric-footnote">{{ stats().reviews.second.percentage | number:'1.0-1' }}% checked</span>
        </article>

        <article class="metric-card">
          <span class="metric-label">3rd review</span>
          <strong class="metric-value">{{ stats().reviews.third.checked | number }}</strong>
          <div class="progress-track" aria-hidden="true">
            <span [style.width.%]="stats().reviews.third.percentage"></span>
          </div>
          <span class="metric-footnote">{{ stats().reviews.third.percentage | number:'1.0-1' }}% checked</span>
        </article>
      </section>

      @if (hasAssignments()) {
        <section class="assignments-section">
          <div class="section-heading">
            <h2>Assignments</h2>
            <span>{{ stats().assignments.length | number }} users</span>
          </div>

          <div class="assignment-grid">
            @for (group of stats().assignments; track group.assignee) {
              <article class="assignment-card">
                <header>
                  <strong>{{ group.assignee }}</strong>
                  <span>{{ group.total | number }} assigned</span>
                </header>

                <div class="assignment-list">
                  @for (assignment of group.assignments; track assignment.id) {
                    <div class="assignment-item">
                      <strong>{{ assignment.assignedSentences || assignment.thadouSentence || assignment.englishSentence || ('Assignment #' + assignment.id) }}</strong>
                      @if (assignment.thadouSentence && assignment.englishSentence) {
                        <span>{{ assignment.englishSentence }}</span>
                      }
                      <small>
                        {{ assignment.status }}
                        @if (assignment.dueDate) {
                          <ng-container> - Due {{ assignment.dueDate | date:'shortDate' }}</ng-container>
                        }
                      </small>
                    </div>
                  }
                </div>
              </article>
            }
          </div>
        </section>
      }

      @if (hasRecentModifiedRows()) {
        <section class="activity-section">
          <div class="section-heading">
            <h2>Recently modified</h2>
            <span>{{ stats().recentModifiedRows.length | number }} shown</span>
          </div>

          <div class="activity-list">
            @for (row of stats().recentModifiedRows; track row.id + row.modifiedAt) {
              <article class="activity-row">
                <div class="sentence-text">
                  <strong>{{ row.thadouSentence || row.englishSentence || 'Sentence text unavailable' }}</strong>
                  @if (row.thadouSentence && row.englishSentence) {
                    <span>{{ row.englishSentence }}</span>
                  }
                  <small>Last modified by {{ row.modifiedBy }}</small>
                </div>
                <div class="review-badges" aria-label="Review status">
                  <span [class.checked]="row.reviews.first">1st</span>
                  <span [class.checked]="row.reviews.second">2nd</span>
                  <span [class.checked]="row.reviews.third">3rd</span>
                </div>
                <time [dateTime]="row.modifiedAt">{{ row.modifiedAt | date:'short' }}</time>
              </article>
            }
          </div>
        </section>
      }

      @if (loading()) {
        <div class="loading-bar" aria-label="Refreshing dashboard"></div>
      }
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
class AppComponent {
  protected readonly stats = signal<DashboardStats>(emptyStats);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly lastUpdated = signal<Date | null>(null);
  protected readonly hasAssignments = computed(() => this.stats().assignments.length > 0);
  protected readonly hasRecentModifiedRows = computed(() => this.stats().recentModifiedRows.length > 0);

  constructor() {
    interval(environment.refreshMs)
      .pipe(
        startWith(0),
        tap(() => {
          this.loading.set(true);
          this.errorMessage.set('');
        }),
        switchMap(() =>
          loadDashboardStats().catch((error: unknown) => {
            const message = error instanceof Error ? error.message : 'Dashboard data could not be loaded.';
            this.errorMessage.set(`${message} Showing last generated snapshot.`);
            return loadStaticDashboardStats();
          })
        ),
        catchError((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Dashboard data could not be loaded.';
          this.errorMessage.set(message);
          return of(null);
        })
      )
      .subscribe((stats) => {
        if (stats) {
          this.stats.set(stats);
          this.lastUpdated.set(new Date(stats.generatedAt));
        }
        this.loading.set(false);
      });
  }
}

async function loadDashboardStats(): Promise<DashboardStats> {
  const rows = await fetchAllRows(sentenceTableId, `(${sourceField},eq,${sourceValue})`);
  const assignmentRows = await fetchAllRows(assignmentsTableId);
  const totalSentences = rows.length;
  const firstChecked = rows.filter((row) => isChecked(row[firstReviewField])).length;
  const secondChecked = rows.filter((row) => isChecked(row[secondReviewField])).length;
  const thirdChecked = rows.filter((row) => isChecked(row[thirdReviewField])).length;

  return {
    generatedAt: new Date().toISOString(),
    source: sourceValue,
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

async function loadStaticDashboardStats(): Promise<DashboardStats | null> {
  const response = await fetch(`dashboard-stats.json?t=${Date.now()}`, {
    cache: 'no-store'
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as DashboardStats;
}

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
  const url = new URL(`/api/v2/tables/${tableId}/records`, nocoDbBaseUrl);
  url.searchParams.set('limit', String(pageSize));
  url.searchParams.set('offset', String(offset));

  if (where) {
    url.searchParams.set('where', where);
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`NoCoDB direct request failed (${response.status}). The table may require auth or CORS may be blocked.`);
  }

  return (await response.json()) as NocoDbListResponse;
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
        first: isChecked(row[firstReviewField]),
        second: isChecked(row[secondReviewField]),
        third: isChecked(row[thirdReviewField])
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

bootstrapApplication(AppComponent).catch((error: unknown) => console.error(error));
