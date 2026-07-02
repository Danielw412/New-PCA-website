# PCA Youth Center Website Guide

## Agent instruction

- Preserve unrelated user changes. Inspect `git status` before editing and do not rewrite or remove files outside the requested scope.
- Do not commit or push unless the user explicitly asks.

## What this repository is

This is the production PCA Youth Center website and event-registration application.

- Frontend: static, multi-page HTML, CSS, and vanilla JavaScript.
- Backend: Supabase Auth and PostgreSQL, accessed directly from the browser with `supabase-js`.
- Hosting: GitHub Pages from this repository.
- Production URL: `https://danielw412.github.io/New-PCA-website/`.
- Production Supabase project: `PCA-Backend`, project ref `ridpqdrikxpwddczdoks`.
- Display timezone: `America/New_York`.

There is no framework, bundler, application server, or server-side rendering. GitHub Pages serves the repository files as-is. All security-sensitive authorization and registration logic therefore belongs in PostgreSQL/RLS, not in browser-only checks.

## Request flow

The main runtime path is:

1. A page loads the HTML5 UP template assets from `assets/css` and `assets/js`.
2. The page loads the custom `styles.css` overrides.
3. The page loads `script.js` after the template scripts.
4. `script.js` handles transitions, scroll reveals, mobile-navigation state, and navigation accessibility.
5. `script.js` dynamically loads `assets/js/pca-backend.js` with a cache-busting query string.
6. `pca-backend.js` loads the pinned Supabase UMD bundle from jsDelivr, creates the public client, restores the Auth session, synchronizes the navigation, and initializes whichever page-specific `data-*` hooks exist.
7. Supabase RLS policies and the `register_for_event` RPC enforce access and registration rules in PostgreSQL.

The HTML `data-*` attributes are a public contract between the markup and `pca-backend.js`. If a hook is renamed in HTML, update the JavaScript in the same change.

## Repository map

### Production pages

| File | Purpose | Access |
| --- | --- | --- |
| `index.html` | Main landing page and homepage content | Public |
| `about.html` | Organization information | Public |
| `membership.html` | Membership information | Public |
| `student-council.html` | Student Council information and link to apply | Public |
| `apply.html` | Student Council application information | Public |
| `events.html` | Events landing page linking to upcoming and past events | Public |
| `upcoming-events.html` | Supabase-backed list of published future events | Public |
| `past-events.html` | Static archive of past events | Public |
| `book-drive.html` | Book-drive details linked from past events | Public |
| `volunteer.html` | Volunteer information | Public |
| `support-us.html` | Donation/support information | Public |
| `bylaws.html` | Bylaws | Public |
| `aapi-statement.html` | AAPI statement | Public |
| `login.html` | Shared sign-in and account-creation page | Public |
| `register.html?event=<uuid>` | Participant registration form for one event | Signed-in users |
| `dashboard.html` | Current account's registrations and participants | Signed-in users |
| `admin-dashboard.html` | Event creation, all registrations, filters, and CSV export | Users listed in `admin_users` |

`index2.html`, `generic.html`, and `elements.html` are original HTML5 UP example/reference pages and are not part of the main PCA navigation. Do not use them as the source of truth for current page structure.

### Frontend files

- `styles.css`: PCA-specific design system and overrides. This is the primary place for site styling changes.
- `script.js`: site-wide interaction, transition, responsive navigation, and backend-loader code.
- `assets/js/pca-backend.js`: all Auth, database reads, RPC calls, dashboard rendering, admin event creation, and CSV export logic.
- `assets/js/main.js`, `util.js`, jQuery, Scrollex, browser, and breakpoints files: upstream HTML5 UP template behavior. Change these only when the template behavior itself must change.
- `assets/css/main.css` and `noscript.css`: compiled HTML5 UP base styles.
- `assets/sass/**`: the original template Sass sources. The deployed site reads the compiled CSS files, not Sass directly.
- `images/**`: production image assets.
- `used website images/**`: duplicate/reference images; production HTML currently uses `images/**`.
- `visual-qa-temp.cjs`: a machine-specific QA helper, not production runtime code. Do not assume its hard-coded Playwright path exists on another machine.

### Backend files

- `supabase/config.toml`: local Supabase project, Auth, redirect, and database configuration.
- `supabase/migrations/*.sql`: the complete, ordered database schema and security history.
- `package.json` and `package-lock.json`: pin the Supabase CLI used for migration work. There are no frontend runtime npm dependencies.

## Frontend architecture

### Page shell

Most production pages share this structure:

- `.pca-page-background`
- `#wrapper`
- `#header`
- repeated `#nav` markup
- `#main`
- `#footer`
- HTML5 UP scripts
- `script.js`

The desktop navigation is repeated in each HTML file. The HTML5 UP runtime creates the mobile navigation panel from it. If a static primary-navigation item changes, update every production page that contains the navigation, then verify both desktop `#nav` and mobile `#navPanel`.

At runtime, `syncNavigation()` in `pca-backend.js` changes the account link to Log In or Dashboard and adds Admin and Sign Out links when appropriate. Do not hard-code admin visibility in HTML as an authorization mechanism.

### Styling rules

- Keep PCA-specific work in `styles.css` unless changing the base template itself.
- Reuse the existing red palette, paper backgrounds, cards, buttons, typography, spacing variables, and responsive breakpoints.
- Keep layouts usable at the existing `980px` and `736px` breakpoints.
- Tables may scroll inside `.table-wrapper` on small screens; the document itself should not gain horizontal overflow.
- Preserve accessible labels, focus behavior, `aria-live` status regions, `hidden` states, and semantic form controls.
- Render database values with `textContent`/`createElement`, not unsanitized `innerHTML`.

### Cache busting

GitHub Pages and browsers may cache static assets aggressively.

- HTML pages load `styles.css?v=<version>` and `script.js?v=<version>`.
- `script.js` loads `assets/js/pca-backend.js?v=<version>`.
- When changing one of these assets, bump the relevant query-string version everywhere that consumes it.
- Keep the `script.js` backend version synchronized with the version used by the HTML pages.
- Use relative URLs such as `assets/js/...` and `dashboard.html`; leading-slash URLs break when hosted under the `/New-PCA-website/` GitHub Pages subpath.

### Page-specific data hooks

- Login: `data-auth-tab`, `data-login-form`, `data-signup-form`, `data-authenticated-panel`.
- Upcoming events: `data-events-status`, `data-events-list`.
- Registration: `data-registration-page`, `data-registration-content`, `data-registration-form`, `data-participant-list`.
- Member dashboard: `data-user-dashboard`, `data-dashboard-name`, `data-dashboard-registrations`.
- Admin dashboard: `data-admin-dashboard`, `data-admin-create-panel`, `data-admin-event-form`, filters, result count, export button, and table body hooks.
- Any `data-backend-status` element is updated if backend initialization fails.

`pca-backend.js` safely does nothing for a page initializer when that page's root hook is absent. This is how one shared backend file serves every page.

## Authentication and authorization

- Users and admins use the same forms in `login.html`.
- Sign-in uses `supabase.auth.signInWithPassword()`.
- Sign-up sends `full_name` as Auth user metadata so the database signup trigger can create the profile row.
- The current v1 config disables email confirmation for immediate access, but the frontend also handles the no-session response used when confirmation is enabled.
- `?next=<relative-page>` is used to return a user to a registration or dashboard after sign-in. `safeNextDestination()` only accepts same-origin HTML destinations inside the current site path.
- Protected pages call `requireSession()` and redirect signed-out visitors to `login.html?next=...`.
- Admin authorization comes only from a row in `public.admin_users`. It must never come from editable user metadata or from showing/hiding a navigation link.
- To promote an admin, first create the account, then insert the Auth user UUID into `public.admin_users` through the Supabase dashboard or another trusted administrative channel.

The publishable key and project URL in `pca-backend.js` are intentionally public browser configuration. Never place a secret key, database password, service-role key, or private environment value in this repository.

## Database model

### `public.profiles`

One row per Auth user, keyed by `auth.users.id`. Stores the account-holder name and current contact email. Triggers create the row after signup and synchronize email changes.

### `public.admin_users`

An allow-list keyed by Auth user UUID. There is no separate admin login and no browser-side role assignment.

### `public.events`

Stores title, description, location, UTC start/end timestamps, capacity, maximum participants per account registration, registration-open state, published state, and timestamps.

- Public visitors see published events.
- Signed-in users can also continue seeing events for which they already have a registration.
- Admins can see all events and create events through `admin-dashboard.html`.
- The admin form interprets entered date/times as `America/New_York` and sends UTC ISO timestamps to Supabase.

### `public.registrations`

One group registration per account/event. The unique constraint on `(event_id, account_id)` prevents duplicate account registration. `participant_count` is the number of consumed/requested seats. `status` is the `confirmed` or `waitlisted` enum.

### `public.registration_participants`

Participant rows belonging to a registration. Stores ordered participant name and grade. Valid grades are Pre-K, K, 1-12, College, Adult, and Not Applicable.

## Registration transaction

The browser must register through `public.register_for_event(p_event_id, p_participants)`. Never add a client-side direct insert into `registrations` or `registration_participants`.

The public wrapper calls `private.register_for_event`, which:

1. Requires an authenticated user and an existing profile.
2. Validates that participants are a non-empty JSON array.
3. Locks the event row with `FOR UPDATE`, serializing competing final-seat requests.
4. Requires a published, open event whose start time has not passed.
5. Enforces the event's per-account participant limit.
6. Rejects duplicate account/event registrations.
7. Validates every participant name and grade.
8. Counts confirmed seats while the event lock is held.
9. Confirms the entire group only if every requested seat fits; otherwise waitlists the entire group.
10. Inserts the registration and participant rows in the same transaction.

Waitlist order is registration creation order. V1 does not include self-service cancellation, editing, or automatic waitlist promotion.

## Row-level security and Data API grants

All exposed tables have RLS enabled. Explicit SQL grants expose only the operations needed by the Data API; RLS then restricts allowed rows.

- Anonymous visitors: select published events only.
- Authenticated users: select their profile, their registrations, their participant rows, and the events needed for those registrations.
- Admins: select all profiles, events, registrations, and participant rows.
- Admins: insert events, guarded by an RLS `WITH CHECK` against `admin_users`.
- Registration writes: only through the granted RPC.
- Users cannot insert themselves into `admin_users`, choose a registration status, or directly create registration rows.

Do not weaken these boundaries to make a client query work. Fix the query, explicit grant, or narrowly scoped policy and verify both the allowed and denied cases.

## Admin dashboard behavior

After `checkAdmin()` succeeds, `admin-dashboard.html` provides:

- A collapsible event-creation form.
- Event and registration-status filters.
- Participant-level rows joined to account and event data.
- Client-side UTF-8 CSV export of the displayed rows.

CSV values are quoted and protected against spreadsheet formula injection. Keep that protection if export fields change. Registration IDs are intentionally included in CSV even when omitted from the visible compact table.

## Supabase migration workflow

Never edit a migration that has already been applied to the remote project. Add a new migration.

On Windows, use the repository-pinned CLI:

```powershell
.\node_modules\.bin\supabase.cmd --version
.\node_modules\.bin\supabase.cmd migration new descriptive_change_name
```

Always inspect current CLI help before relying on a command or flag:

```powershell
.\node_modules\.bin\supabase.cmd migration --help
.\node_modules\.bin\supabase.cmd db push --help
```

Before applying a migration:

1. Review the generated SQL file.
2. Confirm every exposed table has RLS and explicit grants.
3. Test authorization predicates with both allowed and denied identities.
4. Dry-run against the linked project:

```powershell
.\node_modules\.bin\supabase.cmd db push --linked --dry-run
```

5. Apply only after reviewing the dry run:

```powershell
.\node_modules\.bin\supabase.cmd db push --linked --yes
```

6. Run Supabase security and performance advisors after DDL changes.
7. Confirm the remote migration history matches the local files.

If changing Auth redirects or password requirements, keep `supabase/config.toml`, the deployed Supabase Auth settings, and the GitHub Pages URL aligned.

## Local development

Serve the repository over HTTP. Do not open pages with `file://`, because Auth, relative URLs, and browser security behavior will differ.

```powershell
python -m http.server 3000 --bind 127.0.0.1
```

Open `http://127.0.0.1:3000/index.html`.

The production frontend talks to the remote `PCA-Backend` project even when served locally. Treat test signups and event creation as real remote data unless deliberately using a separate Supabase environment.

### Shared test account

Use the premade account documented in the Git-ignored local file `test-credentials.local.md` for normal sign-in, session, registration, and member-dashboard testing. If that file is missing, ask the maintainer for the test credentials; never invent credentials or add them to a tracked file.

Do not change the shared account email or password or delete the account. Do not assume the account is an administrator; check its current `admin_users` membership before testing admin-only behavior. Remember that registrations made with this account are written to the live remote Supabase project, not a local mock.

## Verification checklist

Use checks proportional to the change. For backend or user-flow work, cover the complete flow rather than only syntax.

### Fast static checks

```powershell
node --check script.js
node --check assets\js\pca-backend.js
git diff --check
```

### Frontend checks

- Test desktop and mobile widths.
- Check for document-level horizontal overflow.
- Verify the desktop and generated mobile navigation.
- Verify page transitions and direct page loads.
- Verify loading, empty, success, and error states.
- Check browser console errors.
- Confirm changed CSS/JS cache versions are actually served by GitHub Pages after deployment.

### Auth and member checks

- Create account, sign in, sign out, and restore a saved session.
- Test a protected-page redirect and return via `next`.
- Confirm anonymous users can view published events but cannot register.
- Confirm users see only their own profile, registrations, and participants.
- Confirm a user retains access to an event attached to an existing registration even if the event is later unpublished.

### Registration checks

- Confirm a group when all requested seats fit.
- Waitlist the whole group when all seats do not fit.
- Reject duplicate registrations.
- Reject closed, unpublished, or started events.
- Reject an invalid grade or a group over the event limit.
- If the RPC or capacity logic changes, test concurrent requests for the final seats.

### Admin checks

- Confirm a non-admin cannot read all registrations or create an event.
- Confirm an admin can create both published events and drafts.
- Confirm event times display correctly across daylight-saving and standard time.
- Verify filters and the participant count.
- Export CSV and check commas, quotes, Unicode, and formula-like values.

## Deployment

The site deploys through GitHub Pages from the Git repository. A normal production change is:

1. Complete local and Supabase verification.
2. Review `git diff` and ensure no secrets or temporary QA artifacts are included.
3. Commit only the intended files.
4. Push the requested branch; production currently follows `main`.
5. Wait for Pages to update, then verify the live HTML and cache-busted CSS/JS under `/New-PCA-website/`.

The configured Git remote is `https://github.com/Danielw412/New-PCA-website.git`.

## Common mistakes to avoid

- Do not introduce a framework or build step for a targeted change without explicit approval.
- Do not use leading-slash asset or page URLs on GitHub Pages.
- Do not rely on hidden UI for authorization; RLS/database checks are authoritative.
- Do not expose a service-role key to solve an RLS problem.
- Do not directly insert registrations from the browser.
- Do not let the client choose confirmed versus waitlisted status.
- Do not store event timestamps as naive local strings; inputs are Eastern Time and database values are UTC `timestamptz`.
- Do not forget that the primary navigation is duplicated across HTML pages.
- Do not edit only Sass and expect the deployed CSS to change.
- Do not forget to bump cache-busting versions after CSS or JavaScript changes.
- Do not leave temporary QA pages, screenshots, test accounts, or test events in production.
