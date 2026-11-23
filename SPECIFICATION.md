# Build OpenTrack — Production-Ready Multi-Tenant SaaS

## Objective

Build a complete, responsive, production-oriented SaaS web application called **OpenTrack**.

**Tagline:** Every open matter. One clear path to closure.

OpenTrack helps businesses track unresolved matters, requests, approvals, complaints, tasks and follow-ups from the date they open until their actual closure.

This is not a conventional project-management platform. Its primary purpose is lifecycle visibility, ownership, accountability, follow-up management and resolution tracking.

Build a functioning application with persistent database storage, authentication, authorization, tenant isolation, real workflows and deployment readiness.

Do not deliver a static UI prototype or an application that relies on localStorage for business data.

## 1. Technology stack

Preferred stack:

- Next.js with TypeScript
- Tailwind CSS and accessible UI components
- Supabase PostgreSQL
- Supabase Auth
- PostgreSQL Row Level Security
- Supabase private object storage
- A maintained timeline/Gantt visualization library
- Resend or equivalent for transactional emails
- Deployment compatible with Vercel

Use stable, maintained packages. Avoid unnecessary dependencies.

If a technology cannot be provisioned in the current environment, implement its integration, provide environment variable templates and clearly identify the remaining setup steps. Never simulate a successful backend connection.

## 2. Multi-tenant SaaS architecture

Implement workspace-based multi-tenancy.

Each business has its own workspace containing users, departments, matters, comments, attachments, notifications and activity history.

A user may belong to multiple workspaces with different roles.

Workspace switching must be supported.

Tenant isolation is mandatory:

- Enable RLS on every tenant-owned table.
- Every database read, insert, update and delete must be authorized against the authenticated user's workspace membership and role.
- Enforce tenant consistency across related records.
- Never authorize access based solely on a workspace ID supplied by the client.
- Prevent cross-tenant data access through APIs, exports, attachments, notifications, search and realtime subscriptions.
- Keep service-role credentials strictly server-side.
- Avoid privileged database functions unless necessary; review their security context.
- Use private file storage with tenant-aware authorization and short-lived signed URLs where appropriate.
- Ensure database errors do not expose other tenants' information.

Implement automated cross-tenant authorization tests.

## 3. Authentication and onboarding

Implement:

- User registration and login
- Email verification
- Password reset
- Secure session management
- Workspace creation
- Workspace invitation by email
- Invitation acceptance
- Workspace switching
- Member removal and role management

Roles:

**Workspace Admin:** Full control of the workspace, settings, departments, members, matters and exports.

**Manager:** Manage matters, assignments and reporting within authorized departments.

**Member:** Create matters and access matters assigned to them, created by them or explicitly shared with them.

All authorization must be enforced server-side and at the database level.

Prevent unauthorized users from escalating their own roles.

## 4. Matter data model

Each matter must include:

- Unique ID
- Workspace ID
- Human-readable reference number
- Title
- Description
- Category
- Department
- Responsible owner
- Created by
- Awaiting action from
- Priority: Low, Medium, High, Critical
- Status: Open, In Progress, On Hold, Closed, Cancelled
- Open date
- Expected close date
- Actual close date
- Next follow-up date
- Client/vendor/project reference
- Hold reason
- Resolution note
- Attachments
- Created timestamp
- Updated timestamp
- Closed timestamp
- Reopened timestamp, where applicable
- Soft-delete timestamp, where applicable

Maintain separate relational tables for comments, attachments, activity history, lifecycle events and authorized matter access.

Use UUID primary keys and appropriate indexes.

Use tenant-scoped uniqueness for human-readable reference numbers.

Enforce referential integrity and tenant consistency.

## 5. Lifecycle rules

The application must enforce these rules:

1. A new matter begins in Open status.
2. Open, In Progress and On Hold are unresolved states.
3. Closed requires a resolution note.
4. Actual closure timestamps must be generated and validated on the server.
5. Cancelled requires a reason and is treated as a separate terminal state.
6. Reopening preserves the previous closure or cancellation event.
7. A reopened matter starts a new lifecycle interval.
8. Deadline modifications must be recorded in the audit history.
9. On Hold requires a reason and next review date.
10. On Hold does not automatically suspend overdue calculations.
11. Unauthorized users cannot edit closure history or audit events.
12. Soft-deleted matters remain available to authorized administrators for recovery and audit.

Do not allow users to bypass lifecycle rules through direct API calls.

## 6. Main application screens

### Dashboard

Display:

- Total unresolved matters
- Overdue matters
- Due within the next seven days
- Awaiting action from others
- Matters with no recent updates
- Recently closed matters
- Matters assigned to the current user

Provide direct navigation from dashboard metrics to the relevant filtered matter list.

All dashboard figures must come from real database queries.

### Timeline / Gantt

This is the primary product differentiator.

Display matters as horizontal bars against calendar dates.

Requirements:

- Bar starts on the matter's open date.
- Unresolved matters extend through today.
- Closed matters end on their actual close date.
- Cancelled matters end on their cancellation date.
- Reopened matters must preserve previous lifecycle intervals.
- Expected closure appears as a separate deadline marker.
- Overdue unresolved matters appear in red.
- Open matters appear in blue.
- In Progress matters appear in orange.
- Closed matters appear in green.
- On Hold and Cancelled must have distinguishable styling.
- Provide a legend that does not rely on color alone.
- Support day, week and month views.
- Provide filtering by owner, department, priority, status and date range.
- Clicking a bar opens matter details.
- Handle long-running matters without truncating their actual history.
- Support horizontal scrolling and usable mobile navigation.

Use the workspace timezone for business-date calculations.

### Matter List

Provide a searchable, sortable and filterable table.

Columns:

- Matter reference
- Title
- Owner
- Department
- Status
- Priority
- Open date
- Expected close date
- Age in days
- Overdue days
- Next follow-up

Support pagination and saved URL-based filter state.

### Matter Details

Display:

- Matter summary
- Current owner
- Current status
- Important dates
- Resolution and follow-up information
- Comments
- Attachments
- Complete activity timeline
- Previous status changes
- Reassignment history
- Deadline modifications
- Closure and reopening events

Support editing according to permissions.

### My Work

Display matters assigned to the logged-in user.

Include:

- Due today
- Overdue
- Upcoming
- Awaiting action
- Recently updated

### Waiting on Others

Display matters for which the current user remains responsible but is awaiting action from another person or party.

Include the waiting reason and next follow-up date.

### Workspace Administration

Allow authorized admins to:

- Edit workspace name and timezone
- Create departments
- Manage members and invitations
- Assign roles
- Review workspace activity
- Configure notification preferences
- Export authorized workspace data

## 7. Comments, attachments and audit trail

Implement persistent comments with author and timestamp.

Attachments must:

- Be stored privately
- Enforce workspace and matter permissions
- Validate file types and sizes
- Use safe generated storage paths
- Prevent unauthorized downloads
- Support secure removal without destroying required audit metadata

Implement append-only audit events for:

- Matter creation
- Status changes
- Owner changes
- Department changes
- Deadline changes
- Priority changes
- Closure
- Reopening
- Cancellation
- Soft deletion
- Permission and membership changes

Record actor, timestamp, event type, affected record and relevant before/after values.

Prevent ordinary users from modifying or deleting audit records.

## 8. Notifications

Implement:

- In-app notifications
- Due-soon reminders
- Overdue reminders
- Assignment notifications
- Reassignment notifications
- Closure and reopening notifications

Provide a daily email digest using a scheduled server-side job.

Ensure reminders are idempotent so retries do not send duplicates.

Respect workspace timezone and user notification preferences.

Do not expose confidential matter details in emails to unauthorized recipients.

## 9. Reporting and export

V1 reporting must include:

- Open matters by status
- Overdue matters by department
- Matters by owner
- Average age of unresolved matters
- Matters closed during a selected period

Allow authorized users to export tenant-scoped matter data as CSV.

Protect CSV exports against formula injection.

Do not treat CSV export as a replacement for database backups.

## 10. Database and security

Provide complete SQL migrations.

Implement:

- Tables and relationships
- Constraints
- Indexes
- RLS policies
- Appropriate database functions and triggers
- Tenant-aware access controls
- Lifecycle validation
- Audit event generation

Apply input validation on the server.

Protect against injection, unauthorized object access, privilege escalation, cross-tenant access and unsafe file uploads.

Use secure cookies/session handling and appropriate request protections.

Implement rate limiting for sensitive operations.

Never expose database secrets or privileged keys in client bundles.

## 11. SaaS readiness

Prepare the architecture for future commercial subscriptions.

Include:

- Subscription plan definitions
- Workspace subscription state
- Configurable limits for members, storage and matters
- Centralized entitlement checks
- A future billing-provider integration boundary

Do not implement payment processing in V1.

Do not expose subscription controls that are nonfunctional.

Create a minimal internal operator capability for support and workspace provisioning, separate from ordinary tenant roles.

Operator access must not automatically grant unrestricted access to customer matters. Any exceptional support access must be explicit, time-limited and audited.

## 12. Design requirements

Create a premium, clean, modern B2B SaaS interface.

Design direction:

- Light theme by default
- White and neutral backgrounds
- Restrained blue primary color
- Red for overdue
- Orange for in-progress
- Green for closed
- Clear typography
- Compact but readable tables
- Strong visual hierarchy
- Responsive navigation
- Accessible controls
- Keyboard navigation
- Helpful empty states
- Loading and error states
- Confirmation for destructive actions

The application should feel simple enough for non-technical business users.

Prioritize functionality and clarity over decorative animations.

## 13. Reliability and operations

Provide:

- Separate development and production environments
- Environment variable documentation
- Error monitoring integration
- Health-check endpoint
- Structured server logs without sensitive data
- Database backup configuration instructions
- Backup retention and restoration procedure
- Migration and rollback guidance
- Deployment instructions
- Clear ownership of scheduled jobs

Verify that the chosen database plan actually supports the required backup frequency and recovery capability.

Do not claim backups are active unless they are configured and verified.

## 14. Testing

Create automated tests for:

- Authentication
- Workspace creation
- Invitations
- Role permissions
- Tenant isolation
- Matter creation and editing
- Lifecycle transitions
- Deadline calculations
- Reopening
- Timeline rendering
- Comments
- Attachments
- Notifications
- CSV export

Mandatory security scenarios:

- Business A cannot read Business B's matters.
- Business A cannot update Business B's records.
- Business A cannot download Business B's attachments.
- A Member cannot grant themselves Admin permissions.
- A removed member immediately loses workspace access.
- A forged workspace ID cannot bypass authorization.
- Unauthorized exports fail.
- Audit history cannot be altered through normal application APIs.

Include a documented test procedure for restoring backups into a separate environment.

## 15. Delivery requirements

Deliver:

1. Complete source code.
2. Database schema and migrations.
3. RLS policies.
4. Working frontend and backend.
5. Authentication and onboarding.
6. Functional multi-tenant workflows.
7. Test suite.
8. Environment variable template.
9. Local development instructions.
10. Deployment instructions.
11. Backup and recovery documentation.
12. List of configured services and outstanding setup requirements.

Use seeded demonstration data only in development or test environments.

Do not silently replace backend operations with mock data.

If an integration cannot be completed, identify it clearly as incomplete rather than presenting a nonfunctional interface.

## 16. Implementation sequence

Build in this order:

**Phase 1 — Foundation:** Project structure, database, authentication, workspace onboarding, memberships, tenant isolation and RLS tests.

**Phase 2 — Matter lifecycle:** Matter CRUD, assignment, status transitions, closure, reopening, comments and audit history.

**Phase 3 — Core interface:** Dashboard, matter list, detail screens, My Work, Waiting on Others and timeline.

**Phase 4 — Operations:** Attachments, notifications, exports, monitoring, backup documentation and workspace administration.

**Phase 5 — Verification:** Automated tests, cross-tenant security tests, responsive testing, deployment and production readiness review.

Do not proceed to a later phase while foundational security tests are failing.

## 17. Definition of done

OpenTrack V1 is complete only when:

- Two independent businesses can create separate workspaces.
- Their users can log in and manage their own matters.
- Tenant isolation is enforced by the database.
- Matter changes persist across sessions and devices.
- The timeline accurately reflects actual open and closure dates.
- Reopened matters preserve previous history.
- Role restrictions work even when API requests are manipulated.
- Attachments are private.
- Audit history is preserved.
- Notifications are functional.
- Exports contain only authorized data.
- Deployment and recovery procedures are documented.
- All critical automated tests pass.

Begin by presenting the proposed architecture, database schema, authorization model and implementation plan.

Then implement the application incrementally.

Prioritize correctness, data security and maintainability over rapid visual prototyping.