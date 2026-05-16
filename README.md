# Translation Review Dashboard

Read-only GitHub Pages dashboard for tracking Gemini-sourced translation sentence review progress.

The GitHub Pages dashboard fetches NoCoDB directly from the browser every 60 seconds without an API token. This requires the self-hosted NoCoDB endpoints to allow unauthenticated browser reads and CORS for the dashboard origin. The Angular app never receives the NoCoDB API token.

## Project Structure

- `apps/dashboard` - Angular standalone dashboard app
- `apps/dashboard/public/dashboard-stats.json` - fallback placeholder JSON
- `scripts/generate-dashboard-stats.ts` - GitHub Actions data generator
- `.github/workflows/pages.yml` - scheduled GitHub Pages build and deploy
- `worker` - optional phase 2 Cloudflare Worker API

## GitHub Repository Secrets

Create these repository secrets before running the Pages workflow:

```text
NOCODB_BASE_URL=https://nocodb.horizon.kukiinpi.us
NOCODB_API_TOKEN=<secret token>
NOCODB_TABLE_ID=mf28g2tn6zzdo3e
NOCODB_SOURCE_FIELD=Source
NOCODB_SOURCE_VALUE=gemini
NOCODB_FIRST_REVIEW_FIELD=1st Review
NOCODB_SECOND_REVIEW_FIELD=2nd Review
NOCODB_THIRD_REVIEW_FIELD=3rd Review
```

Only `NOCODB_API_TOKEN` is sensitive, but the workflow reads all configuration from secrets so production configuration stays outside the Angular build.

## GitHub Pages Deployment

The workflow in `.github/workflows/pages.yml`:

- runs on pushes to `main`
- runs every 5 minutes
- supports manual `workflow_dispatch`
- fetches all NoCoDB records from `/api/v2/tables/{tableId}/records`
- filters with `where=(Source,eq,gemini)`
- handles limit/offset pagination
- fetches hardcoded assignment table `mhub16ztknqh5x6`
- includes the 20 most recently modified Gemini rows with sentence text, modifier, timestamp, and review status
- writes fallback summarized data to `dashboard-stats.json`
- builds with `ng build --configuration production --base-href /horizon-translation-dashboard/`
- deploys `dist/dashboard/browser` to GitHub Pages

Enable GitHub Pages for the repository with the source set to GitHub Actions.

## Local Setup

Use an Angular-supported LTS Node line such as Node 22 or 24.

```bash
npm install
```

Run the dashboard with the committed placeholder summary:

```bash
npm run dashboard:dev
```

Generate real summary data locally only if you have the NoCoDB token available. You can export the variables in your shell, or create an ignored `.env.local` file using `.env.example` as the template:

```bash
npm run stats:generate
```

Build for GitHub Pages:

```bash
npm run dashboard:build:pages
```

## Dashboard Data Contract

`dashboard-stats.json` contains aggregate data only:

```json
{
  "generatedAt": "2026-05-16T20:00:00.000Z",
  "source": "gemini",
  "totalSentences": 1200,
  "reviews": {
    "first": { "checked": 980, "percentage": 81.7 },
    "second": { "checked": 630, "percentage": 52.5 },
    "third": { "checked": 240, "percentage": 20 }
  },
  "assignments": [
    {
      "assignee": "reviewer@example.com",
      "total": 3,
      "assignments": [
        {
          "id": "456",
          "assignedSentences": "12701-12800",
          "thadouSentence": "Assigned Thadou sentence",
          "englishSentence": "Assigned English sentence",
          "status": "Assigned",
          "dueDate": ""
        }
      ]
    }
  ],
  "recentModifiedRows": [
    {
      "id": "123",
      "thadouSentence": "Example Thadou sentence",
      "englishSentence": "Example English sentence",
      "modifiedBy": "reviewer@example.com",
      "modifiedAt": "2026-05-16T20:00:00.000Z",
      "reviews": { "first": true, "second": false, "third": false }
    }
  ]
}
```

Notes and API tokens are not written to the JSON file.

## Optional Cloudflare Worker

The `worker` folder is kept as an optional backend/proxy. GitHub Repository Secrets are available only to GitHub Actions; they are not available inside Cloudflare Workers. If the Worker is used later, set Cloudflare Worker secrets and variables separately, especially:

```bash
npx wrangler secret put NOCODB_API_TOKEN --config worker/wrangler.toml
```

The current GitHub Pages dashboard does not require the Worker.
