# OpenTrack setup

## 1. Try the app on your computer
You can run the complete Supabase development stack locally without signing up for a hosted project. The first launch needs internet access to download Docker images. The Node application itself has zero npm package dependencies.

1. Install Node.js 22 or newer, Docker Desktop, and the Supabase CLI. On Windows, start Docker Desktop with its Linux/WSL 2 engine. Follow the CLI installation guide at https://supabase.com/docs/guides/local-development/cli/getting-started . Confirm that `node -v`, `docker info` and `supabase --version` work in a new terminal.
2. Extract the ZIP. Open the **OpenTrack** folder containing package.json. In Windows Explorer, type **powershell** in that folder's address bar and press Enter.
3. Run `npm run local`. This starts the database, email inbox and auth services, applies migrations, creates an ignored local settings file and starts the app. Existing local data is kept between launches. If PowerShell blocks npm.ps1, run `npm.cmd run local`.
4. Visit http://localhost:3000 and select **Create account**. Open http://localhost:54324 for the verification message. Verify your email, then create your business workspace. The first user becomes its administrator.
5. Click **New matter**, choose a department, enter a title and deadline, then create it. Close it with a resolution, reopen it and open **Timeline** to see both intervals. To try a colleague's view, use **Workspace → Invite member**, copy the invitation link and open it in another browser profile signed in with the invited email.
6. Press Ctrl+C to stop the web app. Run `supabase stop` to stop the local services. Leave Docker volumes intact to preserve your data. Run `npm run local` again to restart.

## 2. Verify before adding business data
Run `npm test` for the server, CSV, date and interval checks. With the local stack running, execute these two commands from the project folder. These use the local development database only.

    docker cp test/isolation.sql supabase_db_opentrack:/tmp/isolation.sql
    docker exec supabase_db_opentrack psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/isolation.sql

Repeat with workflows.sql:

    docker cp test/workflows.sql supabase_db_opentrack:/tmp/workflows.sql
    docker exec supabase_db_opentrack psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/workflows.sql

Both scripts run fixtures inside a transaction and should finish with ROLLBACK and exit code zero. The included GitHub Actions workflow runs these with a real local Supabase stack. Enable Actions in your repository to run it there.

## 3. Put a staging version online
1. Create a Supabase organization and a fresh **staging** project. Save the database password in your password manager. Copy its **project reference**, **project URL** and **publishable key** from the dashboard.
2. In the project folder run `supabase login`, then `supabase link --project-ref YOUR_PROJECT_REF`. Run `supabase db push --dry-run`, inspect the four migrations, then `supabase db push`. Use an empty OpenTrack project. If you already applied the earlier foundation ZIP, start a fresh staging project or prepare a reviewed migration baseline.
3. Deploy this folder to a Node 22 host or a Docker-capable host. For a Node host set the start command to `node server.mjs`. For Docker use the included Dockerfile. The service listens on the host's PORT or 3000. Route HTTPS to this service. Set APP_URL to the exact public origin (for example https://opentrack.example.com), SUPABASE_URL to the project URL, and SUPABASE_PUBLISHABLE_KEY to its publishable key. For a local app connected to staging, copy .env.example to .env, fill it in and run `npm start`.
4. In Supabase Authentication enable email/password signup and email confirmation. In URL Configuration set Site URL to the same APP_URL and allow only your intended callback URLs. In Email Templates paste the contents of supabase/templates/confirm.html into Confirm signup and reset.html into Reset password. These templates send a token hash to the application's verification route. Configure production SMTP for account verification and password reset. Test both from a real external inbox.
5. In the host's environment manager set RESEND_API_KEY and MAIL_FROM if you want the app to send invitations by email. Verify the sending domain with Resend. Otherwise the administrator receives a copyable, email-bound invitation link that expires in seven days. Invitation acceptance requires that exact verified account. No credentials should be pasted into chat or committed to Git.
6. Run a separate scheduled process using this same source and the command `node digest.mjs`. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server-side service_role JWT), APP_URL, RESEND_API_KEY and MAIL_FROM only on this worker as needed. Run hourly across all timezones. The database uses each workspace's local day, deduplicates reminder rows and checks current digest preference. The provider idempotency key is the job UUID. Digest emails contain a sign-in link without customer matter details. Watch the scheduler exit status. Reminder creation runs before email delivery, so a mail failure can leave in-app reminders available. Never place the worker key on the browser or public web service.
7. For production repeat with an independent project and deployment. Run the staging acceptance checklist below first. Service signup, domain selection, paid plans and SMTP sender verification are account-owner steps.

## 4. Staging acceptance
Use two browser profiles and two independent businesses. Create private matters and attachments in each. Add a manager to one department and a member to one matter. Verify their respective lists, exports and downloads. Remove the member and confirm access disappears on refresh. Exercise invitation expiry, signup confirmation, password reset, due dates across local midnight, an on-hold overdue matter, reassignments, reopened intervals, backup restore and email delivery. Verify the mobile navigation and horizontally scrolling timeline with real records.

## Operations and recovery
Health endpoint: GET /health queries the Supabase REST root and returns HTTP 503 on a connection failure. It tests connectivity, not complete schema readiness. Monitor its status externally, forward structured error logs from stdout/stderr, and alert on nonzero scheduled-job exits. Do not log request bodies, tokens or attachment bytes.

Select a backup recovery point objective and retention period with the business owner. Check the actual project's Backups page and verify the selected plan supports that retention and PITR if required. Record the latest successful backup and the date of a restore drill. Daily snapshots alone can lose up to a day of changes. Provider documentation: https://supabase.com/docs/guides/platform/backups . No backup policy is active just because this source is installed.

For an independent logical backup, use the Supabase CLI self-hosted restore guide for your installed version and keep roles, schema and data dumps together in encrypted storage outside the project. Include auth users and tenant tables. Attachment bytes are inside PostgreSQL and travel with the data dump. Archive auth configuration, email templates and provider settings separately. Retain daily copies according to your agreed policy and periodically test them. Guide: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore .

Restore drill: provision a separate isolated project, disable outbound mail and scheduling, restore a backup there using the provider-supported procedure, point a separate staging app at it, check per-workspace counts, download a known attachment and compare its hash, verify intervals and audit history, then run the two-business visibility checks. Record the recovery point, elapsed time and discrepancies before marking the drill successful. Never test restoration over the live database.

Migrations run in timestamp order. Every supplied migration has a transaction. Back up before schema changes. Roll back application code to its prior revision when compatible, otherwise apply a reviewed forward fix or restore into a separate project before switching traffic. Never run db reset on production.

## Design and limits
The application uses a dependency-free Node server, an accessible HTML/JavaScript client, Supabase Auth, PostgREST and PostgreSQL RLS. A private database table stores PDF and PNG attachments up to 2 MiB, with authorization on every download. This keeps attachment recovery in the same backup. Use the Node deployment path above for this release.

Admin, Manager and Member roles are per workspace. Matter visibility and mutation checks run in the database. SQL functions own multi-record transactions. Audit history, comments, notifications, lifecycle intervals, invitations and shares are persisted. Overdue starts the day after expected closure in the workspace timezone. Archived matters are recoverable by administrators. The browser stores session credentials in HttpOnly cookies. The active workspace and filters are encoded in the URL. Local business data is stored in Docker's PostgreSQL volume.

The standard plan initially allows 50 members, 10,000 matters and 1 GiB of private attachment bytes per workspace. A database operator can define plans and change workspace plan/state. The ot.provision function allows an explicitly granted SQL operator to create a workspace for a verified owner. The operator role has no application matter-read grant. Exceptional support access is disabled. No payment provider is configured.

The UI currently loads the authorized workspace result set before filtering or drawing the timeline. Load-test the largest intended workspace before raising limits. For horizontal scaling put distributed request throttling at the ingress and configure Supabase Auth rate limits. The included HTTP limiter is per process. Dates, CSV and server tests are runnable without providers. Live account flows, hosted delivery, provider backups, restore, SQL policies and production load require validation in your environment.

## Verification status of this package
Five automated Node tests passed during packaging. The HTTP integration test uses a controlled auth response to test the server's cookie and request handling. The SQL suites need a running Supabase instance. An optional Playwright smoke test is included in test/browser_smoke.py. Its browser launch was blocked by the build environment's socket restriction. Actual desktop and mobile browser checks remain pending.
