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

interface RuntimeConfig {
  statsUrl?: string;
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
  protected readonly statsUrl = signal(environment.statsUrl);
  protected readonly hasAssignments = computed(() => this.stats().assignments.length > 0);
  protected readonly hasRecentModifiedRows = computed(() => this.stats().recentModifiedRows.length > 0);

  constructor() {
    void this.loadRuntimeConfig();

    interval(environment.refreshMs)
      .pipe(
        startWith(0),
        tap(() => {
          this.loading.set(true);
          this.errorMessage.set('');
        }),
        switchMap(() =>
          loadDashboardStats(this.statsUrl()).catch((error: unknown) => {
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

  private async loadRuntimeConfig(): Promise<void> {
    try {
      const config = await fetch(`runtime-config.json?t=${Date.now()}`, {
        cache: 'no-store'
      }).then((response) => (response.ok ? response.json() as Promise<RuntimeConfig> : null));

      if (config?.statsUrl) {
        this.statsUrl.set(config.statsUrl);
      }
    } catch {
      this.statsUrl.set(environment.statsUrl);
    }
  }
}

async function loadDashboardStats(statsUrl: string): Promise<DashboardStats> {
  const response = await fetch(`${statsUrl}${statsUrl.includes('?') ? '&' : '?'}t=${Date.now()}`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Dashboard stats request failed (${response.status}).`);
  }

  return (await response.json()) as DashboardStats;
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

bootstrapApplication(AppComponent).catch((error: unknown) => console.error(error));
