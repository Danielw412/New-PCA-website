# PCA platform rollout

This upgrade uses an expand/deploy/contract rollout.

## 1. Expand

Apply these migrations in order after a linked dry run:

1. `20260709233656_expand_accounts_registration_blog_platform.sql`
2. `20260709234450_add_platform_rpcs_and_security.sql`
3. `20260709235000_import_legacy_blog_posts.sql`

The expand migration keeps the old physical table names and exposes the canonical names as security-invoker views. This allows the currently published frontend and the new modular frontend to overlap safely.

Before applying, record production counts for profiles, administrators, events, registrations, attendees, volunteer applications, volunteer assignments, and volunteer hours. After applying, read `private.platform_migration_audit` through a trusted SQL channel and confirm every source and canonical count matches.

## 2. Hosted Auth settings

These settings are hosted project configuration and are not changed by PostgreSQL migrations:

- Enable anonymous sign-ins.
- Enable manual identity linking.
- Enable Cloudflare Turnstile CAPTCHA protection and store the secret only in Supabase/Auth configuration.
- Put the matching public Turnstile site key in the `pca-turnstile-site-key` meta tag in `register.html`.
- Enable leaked-password protection while retaining immediate-access email signup and the current password requirements.

`supabase/config.toml` mirrors anonymous sign-in, manual linking, and Turnstile for linked/local configuration. `SUPABASE_AUTH_TURNSTILE_SECRET` must come from an ignored environment file or deployment secret; never commit it.

## 3. Deploy and verify

Deploy the frontend only after the expand migrations and Auth settings are ready. Verify guest registration, guest conversion, existing-email claims, household registration editing/cancellation, FIFO promotion, Teen Member roles, blog ownership, administrator boundaries, and the final-super-admin safeguards.

The browser frontend uses canonical API names. Cached copies of the previous frontend can continue using the legacy physical names during this stage.

## 4. Contract

Create the contract migration only after production traffic and counts have been verified. It should rename the physical legacy tables to their canonical names, replace the temporary views with compatibility views under the old names, refresh grants/RLS relationships, and then remove compatibility objects only after the cache window has passed.

Do not ship the contract migration in the same deployment as the expand migration.

