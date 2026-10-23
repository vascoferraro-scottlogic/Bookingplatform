# Assignment: Project Phoenix — Handover Notes

> **Superseded for setup:** the repository [README](../README.md) is the
> authoritative, up-to-date setup guide (native PostgreSQL, `npm run setup:env`,
> running the tests, Postman). Where this document disagrees with the README,
> follow the README. This file is kept for the assignment brief.

**Client:** A well-meaning but naive startup that went "all in" on AI-driven development.

**Background:** The client discarded their team's engineering best practices, assuming AI tooling would handle everything from design to testing. The result is a system that *appears* to work, but its quality, reliability, and test coverage are complete unknowns. The client has now realised the "magic" was an illusion and has called in your team of experts to assess the damage and create a recovery plan.

**Your Mission:**

1.  **Onboard & Assess:** Get the application running locally. Your first task is to use the same AI tooling (GitHub Copilot) to guide you through the setup, just as the original developers did. Assess the quality of the codebase and its existing tests as you go.
2.  **Identify & Improve:** Find the "AI-generated" anti-patterns, bugs, and quality gaps. Implement targeted improvements in a controlled, professional manner.
3.  **Report & Recommend:** Produce a report detailing your findings, the improvements you made, and a set of sustainable working practices for the client to adopt going forward.

This document contains the original, sparse handover notes from the client. Use them, but your primary tool for this first phase is the AI assistant itself. See how far you can get with prompts like:
- 'How do I get this project running locally?'
- 'What environment variables do I need?'
- 'How do I set up the database for this project?'

---

## Prerequisites (from client)

The original developers confirmed you will need:

- **Node.js 22.12 or newer** — verify: `node --version`
- **Git** — verify: `git --version`
- **VS Code** with **GitHub Copilot** extension (licensed)

---

## Pre-workshop Setup (from client)

### 1. Goal: A running PostgreSQL 16 server

Our app needs a Postgres database. Your goal is to have a running server that you can connect to.

#### Step 1.1: Check for an existing installation

Open a terminal and run: `psql --version`

-   **If it returns `psql (PostgreSQL) 16.x`**: Great, you're on the right version. Skip to **Step 1.3**.
-   **If it returns an older version**: 13 or newer will work (the schema uses `gen_random_uuid()`, which needs PostgreSQL 13+). Anything older, install 16. Skip to **Step 1.3** if you're on 13+.
-   **If the command fails**: You need to install Postgres. Continue to **Step 1.2**.

#### Step 1.2: Install PostgreSQL 16 (if needed)

1.  Download the Windows installer from https://www.postgresql.org/download/windows/ (EDB installer).
2.  Run the installer, accepting defaults. **Remember the superuser password** you set.
3.  The installer will also install **pgAdmin** (a GUI) and **psql** (a command-line tool). It does **not** add `psql` to your `PATH`: add `C:\Program Files\PostgreSQL\16\bin` to it (or use the SQL Shell from the Start Menu).

#### Step 1.3: Ensure the service is running

-   Check in **Windows Services** that a service named `postgresql-x64-16` (or similar) has status "Running".
-   Alternatively, run `pg_isready` in a terminal. It should return `... - accepting connections`.
-   If it's not running, start it from the Services panel.

#### Step 1.4: Create the app database and user

You now need to create the specific user (`booking`) and database (`bookingplatform`) for the app.

1.  Open a `psql` terminal. If you just installed, you can find it in the Start Menu. You'll connect as the `postgres` superuser.
2.  Run the following commands:

```sql
CREATE USER booking WITH PASSWORD 'booking';
CREATE DATABASE bookingplatform OWNER booking;
```

**Troubleshooting this step:**

-   **`ERROR: role "booking" already exists`**: No problem. Someone's been here before. Move on.
-   **`ERROR: database "bookingplatform" already exists`**: Also fine. If you want a clean slate, you can run `DROP DATABASE bookingplatform;` first, but it's not essential.

### 2. Get a Gemini API key

1. Go to https://aistudio.google.com/
2. Sign in with your Google account and accept terms
3. Click **Get API key** → **Create API key**
4. Copy and save the key — you'll need it on the day

> The key is active immediately. Free tier (15 requests/minute) is sufficient.

### 3. Fork and clone the repo

1. Navigate to the repo: https://github.com/Trimble006/Bookingplatform
2. Click **Fork** → create under your own GitHub account
3. Clone your fork locally:

```bash
git clone https://github.com/<your-username>/Bookingplatform.git
cd BookingPlatform
```

---

## On the Day

### Step 1: Create your `.env` file

Run `npm run setup:env` to create `.env` with the local defaults and a generated secret (see the README), or copy the example file by hand:

```bash
copy .env.example .env
```

Open `.env` in VS Code and set the following values.

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://booking:booking@localhost:5432/bookingplatform` |
| `NEXTAUTH_URL` | `http://localhost:3000` |
| `NEXTAUTH_SECRET` | *(generate — see below)* |
| `AGENT_LLM_PROVIDER` | `gemini` (or `stub` if you have no key) |
| `AGENT_GEMINI_API_KEY` | *(your key from pre-work step 2)* |
| `AGENT_GEMINI_MODEL` | `gemini-2.5-flash` |
| `AGENT_SECRET` | *(provided by facilitator)* |

**Note on `AGENT_OWM_API_KEY`**: Leave this blank. The client noted the weather integration for the agent is "unreliable" and they disabled it. This is your first clue.

**Generate NEXTAUTH_SECRET** — run this in your terminal:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Paste the output as the value.

### Step 2: Install dependencies

```bash
npm install
```

(Create `.env` first: the install runs `prisma generate`, which fails without it.)

### Step 3: Run database migrations

```bash
npx prisma migrate deploy
```

### Step 4: Seed the database

```bash
npm run db:seed
```

### Step 5: Start the dev server

```bash
npm run dev
```

### Step 6: Verify

1. Open http://localhost:3000
2. Log in with `admin@lakeview.club` / `club123`
3. Confirm the dashboard loads

---

## Demo Accounts (seeded)

| Email | Password | Role |
|---|---|---|
| `admin@wlbooking.com` | `admin123` | Platform admin |
| `admin@lakeview.club` | `club123` | Tenant admin |
| `user@lakeview.club` | `user123` | Regular user |
| `maint@lakeview.club` | `user123` | Maintenance user |

---

## Troubleshooting

### "Cannot connect to database"

- Check Postgres is running: **Windows Services** → `postgresql-x64-16` should show "Running"
- If stopped, right-click → Start

### Prisma migrate fails with SSL error

- Ensure your `DATABASE_URL` does **not** have `?sslmode=require` at the end
- Local connections don't need SSL

### Port 5432 already in use

- Another Postgres instance may be running, or a previous install wasn't removed
- Check: `netstat -ano | findstr :5432`

### "Permission denied" creating the database

- Re-run the `CREATE USER` / `CREATE DATABASE` commands as the `postgres` superuser

### Gemini returns 429 (rate limited)

- Free tier allows 15 requests per minute
- Wait a few seconds and retry

### `npm run dev` fails on Windows

- If you see an error about `lsof`, ignore it — that's the `restart` script (Unix only)
- `npm run dev` itself is cross-platform and should work fine

---

## Container stack (optional)

> **Separate from the main exercise above.** The assessment runs the app the
> "bare" way (`npm run dev` + local Postgres). The repository's
> `docker-compose.yml` is an optional way to run a production-style build in
> containers.

The compose file defines these services:

| Service | What |
|---|---|
| `postgres` | PostgreSQL 16 with a persistent `pgdata` volume |
| `app-migrate` | One-shot job that applies migrations and seeds (`docker/init.sh`) |
| `app` | The production build of the app, published on `127.0.0.1:3000` |
| `cloudflared` | Public tunnel. **Optional**: only starts with `COMPOSE_PROFILES=tunnel` and a `CLOUDFLARED_TUNNEL_TOKEN` |

There is no reverse proxy, blue/green pair, Unleash or ML service in the
compose file, so there is no `npm run swap` exercise to run against it.

### Prerequisite: a container runtime

You need something that provides `docker` and `docker compose` (for example
Rancher Desktop with the `dockerd (moby)` backend, which is free). Verify with
`docker compose version`.

### Run it

The compose file reads its settings from `.env`. In addition to the values in
the main setup, set `POSTGRES_PASSWORD` (any value), and make `DATABASE_URL`
point at the container, for example
`postgresql://booking:<POSTGRES_PASSWORD>@postgres:5432/bookingplatform`. Then:

```bash
npm run stack:up      # build and start (first build takes several minutes)
npm run stack:logs    # tail logs (Ctrl-C to stop)
npm run stack:down    # stop; the pgdata volume keeps your data
```

Open http://localhost:3000. Use the seeded accounts from the table above.

### Faster start (optional): prebuilt images

If prebuilt images have been published to GHCR you can skip the local build:

```bash
npm run stack:pull
npm run stack:up:ghcr
```

If you forked and published the images yourself, set
`GHCR_OWNER=<your-lowercased-github-owner>` in `.env`.

### Troubleshooting

- **`docker: command not found`**: the runtime isn't installed or isn't on `PATH`.
- **Port 3000 or 5432 already in use**: another process (often a local Postgres
  or a previous run) holds the port. Stop it, or run `npm run stack:down`.
- **First `stack:up` looks stuck**: it is building images; watch `npm run stack:logs`.

### Publishing the prebuilt images (facilitator only)

Run the **Build & publish stack images** GitHub Action (Actions tab, Run
workflow), or push a `v*` tag. It builds two images (`bookingplatform-app` and
`bookingplatform-migrate`) for amd64 and arm64 and pushes them to GHCR. After the
first run, make both packages **public** so testers can pull without
authenticating.
