# Class Companion

A mobile-first web app for classroom attendance based on phone GPS proximity, with a lecturer dashboard.

> **Status:** early development. Available now: accounts (lecturer / student), course creation from a
> roster file, and the location-accuracy debug tool (`/debug/location`).

## Stack

| Part | Tech |
|---|---|
| `client/` | React, Vite, TypeScript, Tailwind CSS, React Router (Hebrew, RTL UI) |
| `server/` | Node.js, Express, TypeScript (run with `tsx`), MongoDB + Mongoose, JWT auth, Vitest |
| `shared/` | Pure logic used by both sides (Haversine distance) |

## Setup

Requires Node.js 22+ and a MongoDB database (a free [MongoDB Atlas](https://www.mongodb.com/atlas) M0 cluster works).

1. **Atlas:** create a free cluster → *Database Access*: add a user → *Network Access*: allow your IP
   (or `0.0.0.0/0` for demos) → *Connect → Drivers*: copy the connection string.
2. **Env:** `cp server/.env.example server/.env`, paste the string into `MONGODB_URI`
   (add a database name before the `?`, e.g. `…mongodb.net/class-companion?…`), and set `JWT_SECRET`
   (`openssl rand -hex 32`).
3. **Install and seed:**

```bash
npm install          # from the repo root — installs client and server
npm run seed         # wipes the DB and creates demo data, prints the logins
```

## Run

```bash
npm run dev:server   # terminal 1 — API on http://localhost:3000
npm run dev:client   # terminal 2 — app on http://localhost:5173 (proxies /api to the server)
npm test             # server tests (in-memory MongoDB, no Atlas needed)
```

Geolocation on a phone requires HTTPS — see [docs/PHONE_TESTING.md](docs/PHONE_TESTING.md).

## Demo data

`npm run seed` creates (password for all: `demo1234`):

- lecturer `lecturer@demo.test` with one course and a 10-student roster (`student1…10@demo.test`)
- students 1–7 already have accounts; 8–10 are on the roster but haven't signed up (try `/signup`)

`samples/roster-sample.xlsx` / `.csv` are ready-made roster files for the **New course** form
(regenerate with `npm run samples -w server`).

## How enrollment works

- A lecturer creates a course and uploads a roster file (`.xlsx` or `.csv`) with the columns
  **שם פרטי, שם משפחה, דוא״ל**. Headers are matched in Hebrew or English, in any order; a preview shows
  the parsed students, skipped rows and removed duplicates before the course is saved.
- Students sign up with email + password only. Their name is taken from the roster.
- A student sees every course whose roster contains their email (case-insensitive). There is no separate
  enrollment step: adding an email to a roster makes the course appear for that student.
- Lecturer accounts are created by the seed script; public signup always creates students.

## API

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | public | student signup → `{ token, user }` |
| POST | `/api/auth/login` | public | → `{ token, user }` |
| GET | `/api/auth/me` | any | current user |
| GET | `/api/courses` | any | lecturer: own courses · student: courses listing their email |
| POST | `/api/courses/preview` | lecturer | parse a roster file (multipart `file`) without saving |
| POST | `/api/courses` | lecturer | create course (multipart `name`, `defaultRadiusM`, `file`) |
| GET | `/api/courses/:id/students` | lecturer (own course) | roster with signup status, attendance count / %, last seen, present in active session |

Authenticated requests send `Authorization: Bearer <token>`.

## Project layout

```
client/src/   pages/, components/, hooks/, api.ts (fetch wrapper), auth.tsx (auth context)
server/src/   models/, routes/, middleware/, lib/ (auth, roster parsing), seed.ts
server/tests/ unit tests + API tests (supertest + mongodb-memory-server)
shared/       geo.ts — Haversine distance, single implementation for client and server
samples/      example roster files
docs/         PHONE_TESTING.md
```
