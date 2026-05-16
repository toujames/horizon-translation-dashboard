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

const emptyStats: DashboardStats = {
  generatedAt: '',
  source: 'gemini',
  totalSentences: 0,
  reviews: {
    first: { checked: 0, percentage: 0 },
    second: { checked: 0, percentage: 0 },
    third: { checked: 0, percentage: 0 }
  },
  recentModifiedRows: []
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
            <small>Data {{ lastUpdated() | date:'shortTime' }}</small>
          }
          @if (lastChecked()) {
            <small>Checked {{ lastChecked() | date:'shortTime' }}</small>
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
                  <small>{{ row.modifiedBy }}</small>
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
  private readonly http = inject(HttpClient);

  protected readonly stats = signal<DashboardStats>(emptyStats);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly lastUpdated = signal<Date | null>(null);
  protected readonly lastChecked = signal<Date | null>(null);
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
        this.lastChecked.set(new Date());
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
