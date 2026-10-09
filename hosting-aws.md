# Hosting on AWS

How the BookingPlatform training deployment on AWS is built, why it is built that way, and what it costs.
To use, reset or take down the deployment, see [`aws-operations.md`](aws-operations.md).

This is a **training deployment**, not a highly available production setup. It uses ECS Fargate and RDS
rather than the EC2 + Docker Compose alternative, and it does not by itself change the separate
cloud-provider decision in `DECISIONS.md` (`#hosting-cloud`).

## Architecture (as built)

```
Users
  |  https://gradtesttraining.scottlogic.com   (DNS record in Route 53, managed by IT)
  v
Application Load Balancer (public, 2 subnets/AZs)
  |  HTTPS:443 with an AWS Certificate Manager certificate; HTTP:80 redirects to HTTPS
  v
ECS Fargate service: one Next.js app task (port 3000)
  |
  v
RDS PostgreSQL 16, Single-AZ, private (reachable only from the app's security group)
```

Region: Europe (London), `eu-west-2`. Network: the account's default VPC (public subnets).

## Decisions

- **ECS Fargate + RDS** for a small training cohort; one app task and a Single-AZ database, so no high availability.
- **HTTPS through an AWS load balancer and certificate**, with IT adding two DNS records in Route 53. The compose files
  use a Cloudflare Tunnel, which was the first choice (about $1 a month for a domain). It needs the domain's DNS to be
  hosted on Cloudflare, and the company keeps its DNS in Route 53, so it was dropped. The load balancer adds about
  $25-29 a month.
- **Runs 24/7** at the stakeholders' request. A weekday start/stop schedule was built and tested, then removed.
- **Images from GitHub Container Registry** (public packages, built by the "Build & publish stack images"
  workflow), so no ECR is needed. Tasks have a public IP in public subnets to pull them, which avoids a NAT Gateway.
- **Left out on purpose:** NAT Gateway, ECR, Secrets Manager, WAF, CloudWatch alarms, Multi-AZ, replicas, blue/green,
  Unleash and ML. The database password and `NEXTAUTH_SECRET` are plain environment variables in the task definitions.

## Cost

Estimates from AWS's published pricing, mostly US East rates, so London may be slightly higher. Excludes tax and data transfer.

| Item (per month) | 24/7 |
|---|---|
| Load balancer (hourly charge, its 2 public IPs, usage) | $25-29 |
| Fargate task (0.5 vCPU, 1 GB) | about $21 |
| RDS `db.t4g.micro` instance | about $13 |
| RDS storage (20 GiB gp2) | about $3 |
| Task public IPv4 address | about $4 |
| **Total** | **about $65-69** |

To cut cost, stopping the app and database outside working hours saves about $26 a month (weekdays 8am-6pm comes
to about $39-43), but the load balancer bills around the clock and cannot be paused. Removing the deployment is the only
way to stop the load balancer charge.

## Build steps

Use this to rebuild the environment from scratch. Names match the other doc. Do not commit secrets.

1. **Confirm the basics:** region `eu-west-2`, the default VPC with public subnets in at least two zones, the
   hostname, and that IT can add DNS records in Route 53.
2. **Security groups:**
   - `bookingplatform-alb-sg`: inbound HTTP 80 and HTTPS 443 from the internet.
   - `bookingplatform-app-sg`: inbound port 3000 from `bookingplatform-alb-sg` only.
   - `bookingplatform-db-sg`: inbound PostgreSQL 5432 from `bookingplatform-app-sg` only.
3. **Database:** RDS PostgreSQL 16, `db.t4g.micro`, Single-AZ, 20 GiB, not publicly accessible, `bookingplatform-db-sg`,
   self-managed credentials (a letters-and-numbers password, since it goes in a URL), initial database `bookingplatform`,
   encryption and automated backups on, enhanced monitoring and extended support off.
4. **Images:** run the "Build & publish stack images" workflow (manually, or push a `v*` tag), then make both GHCR
   packages public. Note the 7-character commit tag to use in the task definitions.
5. **ECS cluster and logging:** create the cluster `bookingplatform-cluster` (the first cluster in an account can fail on
   the ECS service-linked role; create the role or retry), the log groups `/ecs/bookingplatform-migrate` and
   `/ecs/bookingplatform-app`, and the task execution role `ecsTaskExecutionRole` (default policy only).
6. **Migrate the database:** create the task definition `bookingplatform-migrate` (Fargate, Linux/X86_64, 0.5 vCPU, 1 GB,
   container `migrate`, the migrate image, command `npx prisma migrate deploy`, environment `DATABASE_URL` ending
   `?sslmode=require`, logging to its log group). Run it once as a one-off task in the public subnets with
   `bookingplatform-app-sg` and a public IP. Expect exit code 0 and "All migrations have been successfully applied".
   `npx prisma migrate status` should then report the schema is up to date.
7. **Certificate:** in AWS Certificate Manager (`eu-west-2`), request a public certificate for the hostname with DNS
   validation. Give IT the validation record (a CNAME). Wait until it shows **Issued**. The record must stay in place
   so the certificate renews automatically.
8. **Load balancer:** create the target group `bookingplatform-tg` (target type IP, HTTP, port 3000, health check path
   `/api/health`, no targets registered). Create the internet-facing ALB `bookingplatform-alb` in two public subnets
   with `bookingplatform-alb-sg` and an HTTP:80 listener. Give IT the ALB's DNS name so the hostname points at it. Then
   add an HTTPS:443 listener with the certificate forwarding to the target group, and change HTTP:80 to a 301 redirect
   to HTTPS.
9. **App task definition:** `bookingplatform-app` (Fargate, Linux/X86_64, 0.5 vCPU, 1 GB, container `app`, the app
   image, port mapping 3000, logging to `/ecs/bookingplatform-app`) with environment variables:
   - `NODE_ENV=production`
   - `APP_COLOR=mvp`
   - `AGENT_LLM_PROVIDER=stub`
   - `NEXTAUTH_URL=https://<hostname>`
   - `NEXTAUTH_SECRET`: a fresh random value (for example `node -p "require('node:crypto').randomBytes(32).toString('base64')"`)
   - `DATABASE_URL`: the database URL ending `?sslmode=require&uselibpqcompat=true`
10. **App service:** create `bookingplatform-app-service` in the cluster: Fargate capacity provider, replica, desired
    count 1, the default VPC's public subnets, `bookingplatform-app-sg`, public IP on, the ALB and `bookingplatform-tg`
    (container `app`, port 3000, the HTTPS:443 listener), health check grace period 300 seconds. The console cannot add a
    load balancer to an existing service, so delete and recreate the service if you need to change it.
11. **Verify:** the target group shows the task **Healthy**; `https://<hostname>/api/health` returns `status: ok`;
    registration and sign-in work.
12. **Optional demo data:** see `aws-operations.md`.

## Things that went wrong, and why

- **Database connections from the app failed with "self-signed certificate in certificate chain".** The app's database
  driver verifies the server certificate when it sees `sslmode=require`, and it does not trust RDS's certificate.
  Appending `&uselibpqcompat=true` makes it behave like the standard PostgreSQL client (encrypted, not verified). Prisma's
  command-line tasks (migrations) work with plain `?sslmode=require`. A stricter fix is to bundle the Amazon RDS CA
  certificate in the image.
- **Sign-in did nothing over `http://<task IP>:3000`.** With an `https` `NEXTAUTH_URL` the app issues
  `__Host-`/`__Secure-` cookies, which browsers reject on plain HTTP. Sign-in needs the real HTTPS address.