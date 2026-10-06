# Hosting on AWS

Deployment runbook for the selected AWS target: one ECS Fargate app service
and one Single-AZ RDS PostgreSQL database. Scope and estimate are maintained
in [`aws-hosting-requirements.md`](../aws-hosting-requirements.md) so cost and
resource assumptions have one source of truth.

This is sized for the small training deployment, not sustained production
traffic. It selects ECS + RDS over the EC2 + Docker Compose alternative for
AWS; it does not by itself change the separate cloud-provider decision in
`DECISIONS.md` (`#hosting-cloud`).

## Architecture

```
Users
  |
  v
Existing approved HTTPS access path (must be confirmed)
  |
  v
ECS Fargate: one Next.js app service
  |
  v
Private RDS PostgreSQL 16: Single-AZ
```

The estimate excludes a load balancer and any new ingress service. ECS and RDS
alone do not provide a stable HTTPS URL; confirm an existing approved access
path before opening the app to users. Do not add new networking, ingress,
registry, or configuration services without updating the estimate and getting
that scope approved.

## Deployment Tasks

1. Confirm the AWS region, existing VPC/network, app image source, and user
   access path. Resolve how users will reach the app over HTTPS before
   provisioning.
2. Create the private RDS instance using the engine, size, storage, and
   availability assumptions in the requirements. Permit database connections
   only from the app task.
3. Make the existing app and migration images available from an approved
   registry. Reuse the existing arrangement if possible; ECR is not required.
4. Create one Linux/x86 Fargate task/service using the app image and port 3000.
   Confirm the calculator-selected vCPU value. Set `DATABASE_URL`,
   `NEXTAUTH_SECRET`, the production `NEXTAUTH_URL`, `NODE_ENV=production`, and
   `AGENT_LLM_PROVIDER=stub`. Do not commit secrets. Expose the app only
   through the approved access path.
5. Run `prisma migrate deploy` from the migration image as a one-off ECS task
   before starting the app and before later schema-changing releases. If demo
   data is needed, seed only the empty database and replace the seed's known
   admin password before users can sign in.
6. Open the app through the approved access path and verify sign-in and one
   database-backed workflow. `/api/health` is a liveness check, not a database
   connectivity check.
7. Document the cohort reset and teardown procedures before the training
   session. Stop or remove billable resources between cohorts as intended;
   confirm data-retention and backup requirements before deleting the database.

## Optional Daily Start/Stop

Manual start/stop is sufficient for the minimal estimate. If automation is
needed, start RDS first, wait until it is available, then set the ECS service
desired count to 1. At closing time, set the ECS desired count to 0 before
stopping RDS. EventBridge Scheduler with a state-aware Lambda is one option,
but adds infrastructure outside the estimate. Account for RDS storage charges
while stopped and its automatic restart after seven consecutive days stopped.
