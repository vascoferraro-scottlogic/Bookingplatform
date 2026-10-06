# AWS Hosting Requirements

Selected AWS architecture and scope assumptions for the training deployment:
one ECS Fargate app task and one Single-AZ RDS for PostgreSQL database. This is
not a highly available production setup. Deployment steps are in
[`docs/hosting-aws.md`](docs/hosting-aws.md).

## Calculator Estimate

- **AWS Fargate:** one Linux/x86 task, 1 GB memory, 20 GB included ephemeral
  storage. Confirm the vCPU value in the calculator; it was not visible in the
  exported estimate.
- **Amazon RDS for PostgreSQL:** PostgreSQL 16, one `db.t4g.micro`, Single-AZ,
  20 GB gp2 storage, no Extended Support.
- The current London estimate is **$15.36/month** for both services at
  **9 hours/day**: Fargate $7.77 and RDS $7.59. This covers only those services
  and usage assumptions, not end-to-end hosting.
- The calculator does not schedule operating hours. Recalculate at 24 hours a
  day if continuous availability is needed. For the 9-hour estimate, an
  operator must start RDS before the app and stop both outside the session.

## Scope Boundaries

- Use the existing approved AWS VPC/network, image source, and user-access
  path. Without an existing ingress path, the app will not have a stable HTTPS
  address. Resolve that separately before opening the app to users.
- No ALB, CloudWatch, ECR, Secrets Manager, NAT Gateway, S3, Unleash, ML,
  additional app replicas, or blue/green deployment is included. Reuse the
  existing image/registry arrangement; ECR is not required.
- Do not add scheduling infrastructure to the minimal estimate. Daily
  start/stop automation is optional and requires a separate estimate.
