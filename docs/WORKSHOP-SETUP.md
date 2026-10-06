# Assignment: Project Phoenix — Handover Notes

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

- **Node.js 18+** — verify: `node --version`
- **Git** — verify: `git --version`
- **VS Code** with **GitHub Copilot** extension (licensed)

---

## Pre-workshop Setup (from client)

### 1. Goal: A running PostgreSQL 16 server

Our app needs a Postgres database. Your goal is to have a running server that you can connect to.

#### Step 1.1: Check for an existing installation

Open a terminal and run: `psql --version`

-   **If it returns `psql (PostgreSQL) 16.x`**: Great, you're on the right version. Skip to **Step 1.3**.
-   **If it returns an older version (12.x, 14.x, etc.)**: That's probably fine. The app isn't using any v16-specific features. Skip to **Step 1.3**.
-   **If the command fails**: You need to install Postgres. Continue to **Step 1.2**.

#### Step 1.2: Install PostgreSQL 16 (if needed)

1.  Download the Windows installer from https://www.postgresql.org/download/windows/ (EDB installer).
2.  Run the installer, accepting defaults. **Remember the superuser password** you set.
3.  The installer will also install **pgAdmin** (a GUI) and **psql** (a command-line tool).

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

### Step 1: Install dependencies

```bash
npm install
```

### Step 2: Create your `.env` file

Copy the example file:

```bash
copy .env.example .env
```

Open `.env` in VS Code and set the following values.

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://booking:booking@localhost:5432/bookingplatform` |
| `NEXTAUTH_URL` | `http://localhost:3000` |
| `NEXTAUTH_SECRET` | *(generate — see below)* |
| `AGENT_LLM_PROVIDER` | `gemini` |
| `AGENT_GEMINI_API_KEY` | *(your key from pre-work step 2)* |
| `AGENT_GEMINI_MODEL` | `gemini-1.5-flash` |
| `AGENT_SECRET` | *(provided by facilitator)* |

**Note on `AGENT_OWM_API_KEY`**: Leave this blank. The client noted the weather integration for the agent is "unreliable" and they disabled it. This is your first clue.

**Generate NEXTAUTH_SECRET** — run this in your terminal:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Paste the output as the value.

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

## Blue/Green Infrastructure Lab (optional, container-based)

> **Separate from the main exercise above.** The Project Phoenix assessment
> runs the app the "bare" way (`npm run dev` + local Postgres). This lab is a
> standalone, hands-on rig for practising **deployment and feature-flag
> management on container infrastructure** — the kind of operational testing
> you'd do against a real blue/green production setup. Each tester runs their
> own copy locally; break it, reset it, that's the point.

### What you'll practise

- Running a multi-service stack (two app "colours", Postgres, a feature-flag
  control plane, an ML sidecar) behind a reverse proxy.
- Promoting a **zero-downtime blue/green deploy** and watching traffic move.
- Flipping a **feature flag** and observing it take effect at runtime.
- Tearing down and bringing back up **without losing data**.

### Prerequisite: a free container runtime

You need something that provides the `docker` and `docker compose` commands.
**Docker Desktop is _not_ required** (and its licence isn't free for larger
companies). Use one of these instead:

| Runtime | OS | Notes |
|---|---|---|
| **Rancher Desktop** (recommended) | Win / macOS / Linux | Free (Apache 2.0). Pick the **`dockerd (moby)`** backend in Preferences → Container Engine. Gives you real `docker` + `docker compose`, plus a GUI to watch containers/logs. |
| Podman Desktop | Win / macOS / Linux | Free (CNCF). Works, but set `COMPOSE_CMD="podman compose"` (see below). |
| Colima | macOS / Linux | Free, CLI-only. No Windows. |

> Verify your install before the day: `docker compose version` should print a
> version. With Rancher Desktop's moby backend, every command below works
> exactly as written.

### Faster start (optional): pull prebuilt images

Building the images locally works, but the first build takes several minutes.
If the facilitator has published the images, you can **pull prebuilt,
multi-arch images** (Apple Silicon + Intel/AMD) from GHCR and skip the build
entirely:

```bash
npm run stack:pull      # download the published images
npm run stack:up:ghcr   # start the stack from them (no local build)
```

Everything else in this lab is identical — same URLs, same `npm run swap`, same
teardown. To switch back to building from source, just use `npm run stack:up`.

> Pulling from a different account? If you forked and published the images
> yourself, point the overlay at your namespace with a `.env` entry:
> `GHCR_OWNER=<your-lowercased-github-owner>`.

### Run the stack

From the repo root:

```bash
npm run stack:up
```

The first run **builds the images and can take several minutes**. Subsequent
runs are fast. When it settles you'll have:

| URL | What |
|---|---|
| http://localhost:8090 | The app (served through Caddy → the live colour) |
| http://localhost:8090/api/health | Liveness JSON: `{ color, release, … }` |
| http://localhost:4242 | Unleash — the feature-flag control plane |

No `.env` is needed for this lab — the compose file supplies safe local
defaults. (The AI agent features stay inert without API keys; they're not part
of this lab.)

Log in with the seeded accounts from the **Demo Accounts** table above
(e.g. `admin@lakeview.club` / `club123`). The Unleash admin console at
:4242 uses `admin` / `unleash4all`.

### Exercise 1 — promote a blue/green deploy

1. Check which colour is live:
   ```bash
   curl http://localhost:8090/api/health
   ```
   Note the `"color"` (e.g. `blue`) and `"release"` fields.
2. Promote the other colour (zero-downtime graceful reload):
   ```bash
   npm run swap
   ```
3. Re-check `/api/health` — `"color"` has flipped. Refresh the app in the
   browser; you stayed logged in and saw no downtime. Run `npm run swap`
   again to flip back. (Force a specific colour with
   `node bin/swap.mjs blue` / `green`.)

### Exercise 2 — flip a feature flag

1. Open Unleash at http://localhost:4242 and log in (`admin` / `unleash4all`).
2. Find a feature flag, toggle it for the development environment, and save.
3. The app's flag SDK polls every ~15 seconds — wait, then refresh the app and
   observe the gated behaviour change. Toggle it back to compare.

### Teardown (data is safe)

```bash
npm run stack:down     # stops containers; the Postgres volume persists
npm run stack:up       # back up again — your data and logins are still there
npm run stack:logs     # tail all service logs (Ctrl-C to stop)
```

Only the `pgdata` volume holds state. Removing containers never loses data; you
would have to explicitly delete that volume to start clean.

### Podman users

The tooling defaults to `docker compose`. If you're on Podman, prefix the
commands with the engine override:

```bash
COMPOSE_CMD="podman compose" npm run stack:up
COMPOSE_CMD="podman compose" npm run swap
```

### Troubleshooting the lab

- **`docker: command not found`** — your container runtime isn't installed or
  isn't on `PATH`. Re-check the prerequisite step; with Rancher Desktop ensure
  it's running and the moby backend is selected.
- **Port 8090 / 4242 / 5432 already in use** — another process (often a local
  Postgres or a previous run) holds the port. Stop it, or run `npm run
  stack:down` to clear a prior stack.
- **First `stack:up` looks stuck** — it's building images. Watch progress in
  another terminal with `npm run stack:logs`, or in your runtime's GUI.

### Publishing the prebuilt images (facilitator only)

Testers pull whatever you've published to GHCR. To (re)publish: run the
**Build & publish stack images** GitHub Action (Actions tab → Run workflow),
or push a `v*` tag. It builds all three images (`bookingplatform-app`,
`-migrate`, `-ml`) for amd64 + arm64 and pushes them to GHCR. After the first
run, make those three packages **public** (GitHub profile → Packages → each
package → Package settings → Change visibility → Public) so testers can pull
without authenticating.
