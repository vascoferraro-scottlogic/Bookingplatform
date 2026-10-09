# Operating the AWS deployment

How to get access to the BookingPlatform deployment on AWS, use it, reset its data, and take it down.
How it is built, why, and the full cost breakdown are in [`hosting-aws.md`](hosting-aws.md).
This is a **training deployment**, not production. Region: **Europe (London), `eu-west-2`**.

## 1. What is deployed

| Part | Name / value |
|---|---|
| Web address | `https://gradtesttraining.scottlogic.com` (DNS records are managed by IT in Route 53) |
| Load balancer | `bookingplatform-alb` (HTTPS:443 with an AWS certificate; HTTP:80 redirects to HTTPS) |
| Target group | `bookingplatform-tg` (port 3000, health check `/api/health`) |
| ECS cluster / service | `bookingplatform-cluster` / `bookingplatform-app-service` (1 task, Fargate) |
| Task definitions | `bookingplatform-app` (container `app`, port 3000) and `bookingplatform-migrate` (container `migrate`, used for one-off jobs) |
| Database | RDS PostgreSQL 16, instance `bookingplatform-db`, private (only reachable from the app's security group) |
| Security groups | `bookingplatform-alb-sg` (public 80/443), `bookingplatform-app-sg` (3000 from the load balancer only), `bookingplatform-db-sg` (5432 from the app group only) |
| Logs | CloudWatch log groups `/ecs/bookingplatform-app` and `/ecs/bookingplatform-migrate` |
| Images | `ghcr.io/vascoferraro-scottlogic/bookingplatform-app` and `...-migrate` (public GitHub packages, built by the "Build & publish stack images" workflow) |

The app and database run 24/7 (there is no start/stop schedule).

## 2. Getting access to AWS

1. [Request access to AWS account](https://myaccess.microsoft.com/@scottlogic.onmicrosoft.com#/access-packages/496167e4-8317-452a-a81b-0ba36fff6e2b).
2. The role you are given needs to be able to: manage **ECS** (describe, update service, run tasks), **RDS** (describe, take snapshots), **EC2** (view and edit security groups, load balancers and target groups), read **CloudWatch Logs**, and pass the ECS task execution role (`iam:PassRole` on `ecsTaskExecutionRole`), which running a one-off task requires. A broad role such as AdministratorAccess works but is more than needed, so ask IT what is appropriate.
3. Sign in through the company's AWS access portal: on the **Accounts** tab, expand the account and click the **role name**. The console opens in a new tab.
4. Set the region (top right) to **Europe (London)**.
5. Check you can open the **ECS**, **RDS**, **EC2** and **CloudWatch** consoles without an access-denied message.

## 3. Using the app

- Open `https://gradtesttraining.scottlogic.com`. You can register a new account or sign in.
- If the demo data has been loaded, the demo accounts are `admin@wlbooking.com` (platform admin), `admin@lakeview.club` (club admin), `user@lakeview.club` and `maint@lakeview.club`. Their passwords are in `prisma/seed.ts` in this repo, so **anyone who can read the repo knows them**. Change them if the site is reachable by people you do not trust.
- If the demo data has not been loaded (or has been wiped), those accounts do not exist.

## 4. Checking health and restarting

If the site does not load:

1. **ECS -> `bookingplatform-cluster` -> `bookingplatform-app-service`**: it should show 1 running task. If it shows 0, set the desired count to 1.
2. **EC2 -> Target Groups -> `bookingplatform-tg` -> Targets**: the task's IP should be **Healthy**. A new task takes about 2.5 minutes to become healthy.
3. **CloudWatch -> Log groups -> `/ecs/bookingplatform-app`**: look at the newest stream for errors.
4. **RDS -> Databases**: `bookingplatform-db` should be **Available**.
5. To restart the app, update the service and choose to force a new deployment (the exact label may vary in the console).

`/api/health` only shows that the app process is alive. It does not test the database.

## 5. Adding the seeded (demo) data

The seed was run once successfully on this deployment (the log ended with `Seed complete.`). Run it again only on an **empty** database: a few records are plain creates, so a second run on a seeded database could duplicate them.

1. In **ECS -> Task definitions -> `bookingplatform-migrate`**, open the latest revision and choose **Deploy -> Run task**.
2. Cluster `bookingplatform-cluster`, capacity provider **FARGATE**, 1 task (not a service). Networking: the default VPC, the public subnets, security group **`bookingplatform-app-sg`** only, public IP **on** (the task downloads a small tool when it runs).
3. In **container overrides**, set:
   - **Command:** `npx,tsx,prisma/seed.ts`
   - **`DATABASE_URL`:** copy the value from the latest `bookingplatform-app` task definition revision. Use the app's value, not the migrate task's, because the seed needs the extra TLS setting that the app uses.
4. Create the task and wait for it to stop. Check the exit code is **0** and that the log in `/ecs/bookingplatform-migrate` ends with `Seed complete.`
5. Sign in as `admin@wlbooking.com` to confirm.
6. If the site is public, consider restricting `bookingplatform-alb-sg` to your own IP while you change the demo passwords, then restore it to Anywhere (`0.0.0.0/0`) on ports 80 and 443.

## 6. Wiping the data

> **Not yet run on this deployment.** The command is checked against Prisma 7's documentation, but run it once at a safe moment and update this section with what you see.

Wiping **deletes everything**: demo data, accounts people registered, and bookings. Take a snapshot first.

1. Tell people the site will be unavailable.
2. **RDS -> `bookingplatform-db` -> Actions -> Take snapshot** (so you can recover if something goes wrong). Snapshots cost storage until deleted.
3. **ECS -> `bookingplatform-app-service`**: set the desired count to **0**, so nothing is connected or writing while the reset runs.
4. Run a one-off task from the latest `bookingplatform-migrate` revision, as in section 5, but with command `npx,prisma,migrate,reset,--force` and **leave the revision's own `DATABASE_URL` as it is**. The reset drops the data and re-applies all migrations.
5. Check the exit code is 0 and read the log. **Check whether the seed ran:** Prisma 7's upgrade notes say reset no longer seeds automatically (and the `--skip-seed` flag was removed), but Prisma's reset page still lists seeding as a step. If the log shows the seed ran, the database is seeded, not clean.
6. To add the demo data afterwards, follow section 5. A clean database needs nothing more.
7. Set the service desired count back to **1** and check section 4.

## 7. Costs and operational notes

Estimated cost running 24/7 is roughly **$65-69 a month**; the load balancer is the largest part. The breakdown is in [`hosting-aws.md`](hosting-aws.md).

Things to know:
- There is **one app task**. ECS restarts it if it crashes, but there is a brief outage.
- RDS has a weekly **maintenance window** (see RDS -> the database -> Maintenance). The database may restart briefly during it.
- **No alarms** are configured, so nobody is alerted if something fails.
- The database password and `NEXTAUTH_SECRET` are stored as plain environment variables in the task definitions. Anyone who can view the task definitions can read them. Treat that access as sensitive.
- The app connects to the database encrypted, but without verifying the server certificate (`uselibpqcompat=true` in the connection string).
- The HTTPS certificate renews automatically, as long as the DNS validation record IT added in Route 53 stays in place.

## 8. Taking it down

Follow this order. AWS blocks deleting things that are in use, so if the console objects, follow its message.

1. Agree what data to keep, and tell the stakeholders and IT the app is being retired.
2. Ask IT to remove the two Route 53 records: the `gradtesttraining.scottlogic.com` address record, and the certificate validation record.
3. **ECS:** set `bookingplatform-app-service` to 0 tasks, delete it, then delete the cluster `bookingplatform-cluster`.
4. **ECS:** deregister all revisions of `bookingplatform-app` and `bookingplatform-migrate`.
5. **EC2 -> Load Balancers:** delete `bookingplatform-alb` (the biggest recurring charge). Wait until it is gone.
6. **EC2 -> Target Groups:** delete `bookingplatform-tg`.
7. **Certificate Manager:** delete the certificate for `gradtesttraining.scottlogic.com`.
8. **RDS:** if the data should be kept, take a final snapshot, then delete `bookingplatform-db`. Deleting normally removes its automated backups unless you choose to keep them. Delete leftover manual snapshots when you no longer need them.
9. **VPC -> Security groups:** delete `bookingplatform-db-sg`, then `bookingplatform-app-sg`, then `bookingplatform-alb-sg`, in that order, since each refers to the next. Leave the default VPC and its subnets alone.
10. **CloudWatch:** delete the log groups `/ecs/bookingplatform-app` and `/ecs/bookingplatform-migrate`.
11. **IAM:** delete `ecsTaskExecutionRole` only if nothing else in the account uses it (check with IT). Leave the ECS service-linked role.
12. **GitHub:** optionally delete the two GHCR packages.
13. The next day, check Billing / Cost Explorer shows no load balancer, RDS or Fargate charges, and search `eu-west-2` for leftovers (ECS, load balancers, RDS, snapshots, network interfaces).
