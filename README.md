# BookingPlatform

A multi-tenant platform for clubs and community organisations.

## Get Started Locally

Prerequisites: Node.js 22.12 or newer and npm. Use either a local PostgreSQL 16
install or Docker for the database. The Docker instructions below use
`docker run` directly and do not depend on the repository's Compose files.

1. Install PostgreSQL 16 on Windows:

  **Local administrator rights may need to be requested to complete this step.**

  ```powershell
  winget install PostgreSQL.PostgreSQL.16
  ```

  During installation, set and remember the password for the `postgres`
  superuser. This is the database administrator password, not the app login
  password. You will enter it when running the `psql` commands below.

  The installer does not add PostgreSQL to your `PATH`, so `psql` will not be
  found yet. Either add `C:\Program Files\PostgreSQL\16\bin` to your `PATH` and
  open a new terminal, or add it for the current session only:

  ```powershell
  $env:Path += ";C:\Program Files\PostgreSQL\16\bin"
  ```

  If another PostgreSQL version is already installed, it probably owns port
  5432 and the new one will have been given 5433 (check the port in the
  installer, or `Get-Service postgresql*`). Add `-p 5433` to the `psql` commands
  below and use that port in `DATABASE_URL`.

  To use Docker instead, skip the native install and follow the Docker note in
  step 3.

2. Create `.env` **before** installing dependencies (the install runs
  `prisma generate`, which needs it), then install:

  ```powershell
  npm run setup:env
  ```

  This copies `.env.example` to `.env` with the local defaults (`DATABASE_URL`
  on port 5432, `NEXTAUTH_URL` `http://localhost:3000`,
  `AGENT_LLM_PROVIDER=stub`) and a freshly generated `NEXTAUTH_SECRET`. It never
  overwrites an existing `.env`; if you already have one, set those values by
  hand. If your PostgreSQL is on another port, edit `DATABASE_URL`.

  Finally, install the dependencies:
  ```powershell
  npm install
  ```

3. Create the app database. For a native PostgreSQL install, open a new
  terminal and run these commands, entering the `postgres` superuser password
  when prompted:

  ```powershell
  psql -h localhost -U postgres -c "CREATE USER booking WITH PASSWORD 'booking';"
  psql -h localhost -U postgres -c "CREATE DATABASE bookingplatform OWNER booking;"
  ```

  Alternatively, for Docker, start a standalone PostgreSQL container. This
  publishes port 5432 for the app's `localhost` connection and does not use
  `docker-compose.yml`:

  ```powershell
  docker run --name bookingplatform-postgres -e POSTGRES_USER=booking -e POSTGRES_PASSWORD=booking -e POSTGRES_DB=bookingplatform -p 5432:5432 -v bookingplatform-pgdata:/var/lib/postgresql/data -d postgres:16-alpine
  ```

  Wait for PostgreSQL to accept connections before continuing:

  ```powershell
  docker exec bookingplatform-postgres pg_isready -U booking -d bookingplatform
  ```

4. Apply database migrations, add local demo data, and start the app:

  ```powershell
  npm run db:setup
  npm run dev
  ```

  Open <http://localhost:3000> and sign in with the local demo platform
  account: `admin@wlbooking.com` / `admin123`.

The demo data is dated relative to the day you run the seed: the Main Green has
season overrides covering this year and next, and the sample events fall in the
next few weeks. Re-running `npm run db:seed` is safe at any time and refreshes
those dates (the sample events are matched by title), so run it again if the
events have drifted into the past.

The demo credentials are for local development only. Optional integrations
such as Unleash, ML, and external AI providers are not needed for this setup.

## Seeded accounts

The club is `lakeview-bowls`.

| Account | Password | Role |
|---|---|---|
| `admin@wlbooking.com` | `admin123` | Platform admin |
| `admin@lakeview.club` | `club123` | Club admin |
| `user@lakeview.club` | `user123` | Member |
| `maint@lakeview.club` | `user123` | Maintenance |

## Running the tests

```powershell
npm test
```

The unit tests need **no database**: Jest ignores `.env`, mocks Prisma and
refuses to touch a real database, so running them never affects your dev data.
Also useful: `npx tsc --noEmit` (type-check) and `npm run lint`.

## Testing the API with Postman

The API uses a next-auth session cookie. To get one:

1. `GET http://localhost:3000/api/auth/csrf` and note `csrfToken` in the JSON.
   Keep Postman's cookie jar on (it stores the CSRF cookie).
2. `POST http://localhost:3000/api/auth/callback/credentials` with body type
   **x-www-form-urlencoded** and the fields `csrfToken`, `email` and `password`
   (a seeded account above). A successful login sets the
   `next-auth.session-token` cookie, which Postman sends on later requests to
   `localhost:3000` automatically.
3. Check it with `GET http://localhost:3000/api/auth/session`, which returns the
   signed-in user.

To put the demo data back to a known state, run `npm run db:seed` again. It
restores the seeded accounts and dates but does not delete anything you
created. To start from scratch, run `npx prisma migrate reset --force` then
`npm run db:seed` (this **erases the whole database**).

## Python (optional, ML scripts only)

`npm run ml:serve` and `npm run ml:train` need Python 3 with the packages in
`ml/requirements.txt`. On Windows install Python from python.org (not the
Microsoft Store stub) and make sure `python` is on your `PATH`. Not needed for
the basic setup.

For the AWS hosting (how it is built) see [hosting-aws.md](hosting-aws.md); to run, reset or take it down see [aws-operations.md](aws-operations.md).
