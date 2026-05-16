# Project Rules

- Keep the dashboard read-only. It must never write to NoCoDB or call NoCoDB directly from browser code.
- Keep NoCoDB credentials only in GitHub Actions secrets or backend runtime secrets. Never put tokens in Angular files.
- Generated dashboard JSON may contain aggregate summaries only. Do not expose raw sentence rows, sentence text, notes, row IDs, or tokens.
- GitHub Actions generates `apps/dashboard/public/dashboard-stats.json` and deploys Angular to GitHub Pages.
- Current live browser data is fetched through the Cloudflare Worker. Do not add `NOCODB_API_TOKEN` to Angular code.
- GitHub Repository Secrets are not available to Cloudflare Workers. If the Worker is used later, configure Cloudflare Worker secrets separately.
- Use TypeScript for all application and Worker code.
- Prefer standalone Angular components and keep dashboard state local unless a real shared state boundary appears.
- Preserve the `dashboard-stats.json` contract unless coordinating a matching dashboard change.
- Keep configuration environment-driven. No base IDs, table IDs, view IDs, or API tokens should be hardcoded into source files.
- Add focused tests or manual verification notes when changing pagination, filtering, or percentage calculations.
