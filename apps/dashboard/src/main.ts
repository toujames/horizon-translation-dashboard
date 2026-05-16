import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { catchError, interval, of, startWith, switchMap, tap } from 'rxjs';

import { environment } from './environments/environment';

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

const emptyStats: DashboardStats = {
  generatedAt: '',
  source: 'gemini',
  totalSentences: 0,
  uniqueContributorCount: 0,
  reviews: {
    first: { checked: 0, percentage: 0 },
    second: { checked: 0, percentage: 0 },
    third: { checked: 0, percentage: 0 }
  },
  contributors: []
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

        <article class="metric-card">
          <span class="metric-label">Contributors</span>
          <strong class="metric-value">{{ stats().uniqueContributorCount | number }}</strong>
          <span class="metric-footnote">Unique users who modified rows</span>
        </article>
      </section>

      @if (hasContributors()) {
        <section class="leaderboard-section">
          <div class="section-heading">
            <h2>Contributor leaderboard</h2>
            <span>{{ stats().contributors.length | number }} shown</span>
          </div>

          <div class="leaderboard">
            @for (contributor of stats().contributors; track contributor.name) {
              <article class="leaderboard-row">
                <div>
                  <strong>{{ contributor.name }}</strong>
                  <span>{{ contributor.count | number }} sentences</span>
                </div>
                <div class="row-progress">
                  <div class="progress-track" aria-hidden="true">
                    <span [style.width.%]="contributor.percentage"></span>
                  </div>
                  <b>{{ contributor.percentage | number:'1.0-1' }}%</b>
                </div>
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
  private readonly http = inject(HttpClient);

  protected readonly stats = signal<DashboardStats>(emptyStats);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly lastUpdated = signal<Date | null>(null);
  protected readonly hasContributors = computed(() => this.stats().contributors.length > 0);

  constructor() {
    interval(environment.refreshMs)
      .pipe(
        startWith(0),
        tap(() => {
          this.loading.set(true);
          this.errorMessage.set('');
        }),
        switchMap(() =>
          this.http.get<DashboardStats>(environment.statsUrl, {
            headers: {
              'cache-control': 'no-cache'
            },
            params: {
              t: Date.now()
            }
          }).pipe(
            catchError((error: unknown) => {
              this.errorMessage.set(error instanceof Error ? error.message : 'Dashboard data could not be loaded.');
              return of(null);
            })
          )
        )
      )
      .subscribe((stats) => {
        if (stats) {
          this.stats.set(stats);
          this.lastUpdated.set(stats.generatedAt ? new Date(stats.generatedAt) : null);
        }
        this.loading.set(false);
      });
  }
}

bootstrapApplication(AppComponent, {
  providers: [provideHttpClient()]
}).catch((error: unknown) => console.error(error));
