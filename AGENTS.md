# PCA Youth Center Website

## Default completion behavior

- Inspect `git status` before editing and preserve unrelated user changes.
- Unless the user explicitly says not to, finish completed work by:
  1. applying reviewed Supabase migrations to the linked production project;
  2. committing only the intended files; and
  3. pushing the current branch.
- Never commit secrets, test credentials, screenshots, or temporary QA artifacts.

## Architecture

- Production static HTML/CSS/vanilla JavaScript site hosted by GitHub Pages.
- Production URL: `https://danielw412.github.io/New-PCA-website/`.
- Supabase project: `PCA-Backend` (`ridpqdrikxpwddczdoks`).
- Display timezone: `America/New_York`.
- Main frontend files: `styles.css`, `script.js`, `assets/js/pca-backend.js`, `assets/js/pca-platform.js`, and `assets/js/modules/**`.
- Database history lives in `supabase/migrations/**`; use the repository-pinned Supabase CLI.

## Frontend rules

- Keep PCA styling in `styles.css`; avoid changing upstream HTML5 UP assets unless required.
- Preserve semantic controls, labels, focus behavior, `aria-live`, `hidden`, and responsive behavior at `980px` and `736px`.
- Render database content with `textContent`/`createElement`, never unsanitized `innerHTML`.
- Treat HTML `data-*` hooks and their JavaScript consumers as one contract.
- Use relative links and asset paths because production is hosted under `/New-PCA-website/`.
- When CSS or JavaScript changes, bump its cache version everywhere it is consumed and keep module/backend versions synchronized.

## Supabase and security rules

- Authorization and registration integrity belong in PostgreSQL/RLS, not hidden browser UI.
- Never expose service-role keys, database passwords, or private environment values.
- Every exposed table requires RLS, narrowly scoped policies, and explicit grants.
- Admin access comes only from `public.admin_users`, never editable user metadata.
- Registration writes must use the registration RPC; never directly insert registration or participant rows or let the client choose registration status.
- Event inputs are Eastern Time; store database timestamps as UTC `timestamptz`.
- Never edit an applied migration. Generate a new one with:

```powershell
.\node_modules\.bin\supabase.cmd migration new descriptive_name
```

- Before applying: inspect CLI help, review SQL/security, and dry-run. Then apply and verify:

```powershell
.\node_modules\.bin\supabase.cmd db push --linked --dry-run
.\node_modules\.bin\supabase.cmd db push --linked --yes
```

- After DDL changes, run security and performance advisors, test the changed behavior, and confirm migration history.

## Testing and deployment

- Serve locally over HTTP, never `file://`:

```powershell
python -m http.server 3000 --bind 127.0.0.1
```

- Minimum checks:

```powershell
node --check script.js
node --check assets\js\pca-backend.js
git diff --check
```

- For frontend changes, verify desktop/mobile layout, overflow, navigation, console health, and relevant loading/error/success states.
- For Auth, registration, RLS, or admin changes, test both allowed and denied identities and the complete affected flow.
- The shared test account is documented only in ignored `test-credentials.local.md`; never expose or modify its credentials. Tests use production data, so do not leave test records behind.
- Before pushing, review the diff for secrets and unrelated files. Production follows `main`; after pushing, verify GitHub Pages and cache-busted assets.
