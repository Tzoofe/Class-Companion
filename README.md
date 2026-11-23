# Class Companion

A mobile-first web app for classroom attendance based on phone GPS proximity, with a lecturer dashboard.

> **Status:** early development. Available now: accounts (lecturer / student), course creation from a
> roster file, a course dashboard (attendance per session, students who need attention, assignments placeholder),
> a student list with per-student attendance, starting / closing an attendance session from
> the lecturer's phone, GPS check-in for students ("I'm here"), and the location-accuracy debug tool
> (`/debug/location`).

## Stack

| Part | Tech |
|---|---|
| `client/` | React, Vite, TypeScript, Tailwind CSS, React Router (Hebrew, RTL UI) |
| `server/` | Node.js, Express, TypeScript (run with `tsx`), MongoDB + Mongoose, JWT auth, Vitest |
| `shared/` | Pure logic used by both sides (Haversine distance) |

## Setup

Requires Node.js 22+ and MongoDB. Everything runs locally; settings live in `server/.env`, so moving
to a hosted server / cloud database later is a configuration change.

1. **MongoDB (macOS):**
   ```bash
   brew tap mongodb/brew && brew install mongodb-community
   brew services start mongodb/brew/mongodb-community   # runs in the background, starts at login
   ```
2. **Env:** `cp server/.env.example server/.env` and set `JWT_SECRET` (`openssl rand -hex 32`).
   The default `MONGODB_URI` points at the local database.
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
| POST | `/api/courses/preview` | lecturer | parse a roster file `{ fileName, fileBase64 }` without saving |
| POST | `/api/courses` | lecturer | create course `{ name, defaultRadiusM, fileName, fileBase64 }` |
| GET | `/api/courses/:id/dashboard` | lecturer (own course) | counts, average attendance % and per-session history (finished sessions, last 12), live session count, up to 5 students under 70% |
| GET | `/api/courses/:id/students` | lecturer (own course) | roster with signup status, attendance count / %, last seen, present in active session |
| GET | `/api/courses/:id/sessions/active` | lecturer (own) / student (on roster) | the active session or `null` |
| POST | `/api/courses/:id/sessions` | lecturer (own course) | start a session from `{ lat, lng, accuracy }`; 400 if accuracy > 100 m, 409 if one is active |
| GET | `/api/sessions/:id` | lecturer (own) | session + `checkedInCount` / `rosterCount` (polled every 3 s) |
| POST | `/api/sessions/:id/close` | lecturer (own) | close early (`endsAt` = close time) |
| POST | `/api/sessions/:id/range` | student (on roster) | `{ lat, lng, accuracy, timestamp }` → `{ inRange, distanceM, alreadyCheckedIn }`; no side effects |
| POST | `/api/sessions/:id/check-in` | student (on roster) | re-validates range with a fresh reading (≤ 30 s) and records attendance once (409 if already) |

Authenticated requests send `Authorization: Bearer <token>`.

## Attendance rules

Defined once in `shared/attendance.ts` and used by both server and client:

- **In range** ⇔ `distance(student, center) − studentAccuracy − centerAccuracy ≤ radius`
  (Haversine distance in a pure, unit-tested function; `$geoNear` was not used because the rule needs both
  accuracy circles, and only one point is ever compared against one center).
- Lecturer can start a session only with accuracy ≤ 100 m (laptops have no GPS, so their Wi-Fi-based
  estimate is often 40–100 m); student readings > 100 m are rejected. The start point's accuracy is added
  to the radius when checking students, so a less precise start makes the check more lenient.
- A session lasts 15 minutes (radius from the course, default 20 m) and auto-closes at `endsAt` the next time it is read.
- Only one active session per course.
- Students never receive the session center; the server computes distance and range.

## Project layout

```
client/src/   pages/, components/, hooks/, api.ts (fetch wrapper), auth.tsx (auth context)
server/src/   models/, routes/, middleware/, lib/ (auth, roster parsing), seed.ts
server/tests/ unit tests + API tests (supertest + mongodb-memory-server)
shared/       geo.ts — Haversine distance, single implementation for client and server
samples/      example roster files
docs/         PHONE_TESTING.md
```
