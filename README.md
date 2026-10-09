# BookingPlatform

A multi-tenant platform for clubs and community organisations.

## Get Started Locally

Prerequisites: Node.js 22 and npm. Use either a local PostgreSQL 16 install or
Docker for the database. The Docker instructions below use `docker run`
directly and do not depend on the repository's Compose files.

1. Install PostgreSQL 16 on Windows:

  **Local administrator rights may need to be requested to complete this step.**

  ```powershell
  winget install PostgreSQL.PostgreSQL.16
  ```

  During installation, set and remember the password for the `postgres`
  superuser. This is the database administrator password, not the app login
  password. You will enter it when running the `psql` commands below.

  To use Docker instead, skip the native install and follow the Docker note in
  step 3.

2. Create `.env`, configure local values, then install app dependencies:

  ```powershell
  if (!(Test-Path .env)) { Copy-Item .env.example .env }
  npm install
  ```

  In `.env`, set `DATABASE_URL` to
  `postgresql://booking:booking@localhost:5432/bookingplatform`, set
  `NEXTAUTH_URL` to `http://localhost:3000`, and set `AGENT_LLM_PROVIDER` to
  `stub`. Generate a local auth secret with:

  ```powershell
  node -p "require('node:crypto').randomBytes(32).toString('base64')"
  ```

  Put the generated value in `NEXTAUTH_SECRET`. Keep any existing `.env` and
  update these values rather than overwriting it.

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

The demo credentials are for local development only. Optional integrations
such as Unleash, ML, and external AI providers are not needed for this setup.

For the AWS hosting (how it is built) see [docs/hosting-aws.md](docs/hosting-aws.md); to run, reset or take it down see [docs/aws-operations.md](docs/aws-operations.md).
