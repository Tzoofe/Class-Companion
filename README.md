# Class Companion

A mobile-first web app for classroom attendance based on phone GPS proximity, with a lecturer dashboard.

> **Status:** early development. Available now: accounts (lecturer / student), course creation from a
> roster file, a course dashboard (attendance per session, students who need attention, assignments placeholder),
> a student list with per-student attendance, a questions & suggestions feed (anonymous option, votes, projector view), live polls, starting / closing an attendance session from
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
| GET | `/api/courses/:id/export` | lecturer (own course) | `.xlsx` download: summary sheet (per student: attended, %, last seen) + one sheet per session (present, source, time, distance, accuracy); times in `TIME_ZONE` (default Asia/Jerusalem) |
| GET | `/api/courses/:id/students` | lecturer (own course) | roster with signup status, attendance count / %, last seen, present in active session |
| GET | `/api/courses/:id/sessions` | lecturer (own course) | all sessions, newest first, with present counts |
| GET | `/api/courses/:id/sessions/active` | lecturer (own) / student (on roster) | the active session or `null` |
| POST | `/api/courses/:id/sessions` | lecturer (own course) | start a session from `{ lat, lng, accuracy }`; 400 if accuracy > 100 m, 409 if one is active; notifies the course's students (push) |
| GET | `/api/sessions/:id` | lecturer (own) | session + `checkedInCount` / `rosterCount` (polled every 3 s) |
| POST | `/api/sessions/:id/close` | lecturer (own) | close early (`endsAt` = close time) |
| GET | `/api/sessions/:id/roster` | lecturer (own) | session summary + every roster student: present, source (`gps` / `manual`), check-in time, distance |
| PUT | `/api/sessions/:id/attendance` | lecturer (own) | `{ email, present }` — mark a roster student present/absent, live or after the session |
| POST | `/api/sessions/:id/range` | student (on roster) | `{ lat, lng, accuracy, timestamp }` → `{ inRange, distanceM, alreadyCheckedIn }`; no side effects |
| POST | `/api/sessions/:id/check-in` | student (on roster) | re-validates range with a fresh reading (≤ 30 s) and records attendance once (409 if already) |

Authenticated requests send `Authorization: Bearer <token>`.

| GET | `/api/courses/:id/posts` | lecturer (own) / student (on roster) | course feed; students never receive the author of others' anonymous posts, nor posts the lecturer hid |
| POST | `/api/courses/:id/posts` | student (on roster) | `{ kind: question\|suggestion, text ≤ 500, anonymous, clientId }`; idempotent per `clientId`; 5/min; tagged "during class" if attendance is open |
| POST | `/api/posts/:id/vote` | student | `{ up }` — one 👍 per student, not on your own post |
| PATCH | `/api/posts/:id` | lecturer (own course) | `{ status?, pinned?, hidden?, reply? }`; a reply marks it answered; the author gets a push |
| DELETE | `/api/posts/:id` | author / lecturer | delete a post |
| GET | `/api/courses/:id/polls` | lecturer (own) / student (on roster) | lecturer: all polls with live results · student: opened polls, own answer, results only once revealed |
| GET | `/api/courses/:id/polls/active` | course member | the open poll (`answered`, `canAnswer` for students) or `null` |
| POST | `/api/courses/:id/polls` | lecturer | create `{ question, type: choice\|yesno\|scale\|text, multiple, options[], correct[], audience: roster\|present, showTextOnScreen, open? }` |
| PUT | `/api/polls/:id` | lecturer | edit a draft |
| POST | `/api/polls/:id/open` · `/close` · `/reveal` · `/duplicate` | lecturer | opening closes the course's other open poll and notifies eligible students |
| DELETE | `/api/polls/:id` | lecturer | delete with its answers |
| PUT | `/api/polls/:id/response` | eligible student | answer or change the answer while open |
| GET | `/api/me/overview` | lecturer | home page: live sessions & polls, totals, top open questions, low-attendance counts, per-course cards (trend, average, last session) |
| GET | `/api/me/agenda?from&days` | any | classes and events of all my courses (lecturer: own; student: roster), with local `now` |
| GET · PATCH | `/api/courses/:id/settings` · `/api/courses/:id` | lecturer (own) | settings view; rename / change default radius |
| POST · DELETE · PUT | `/api/courses/:id/roster[/:email]` | lecturer (own) | add one student · remove one · re-upload a file (`mode: merge\|replace`) |
| GET · PUT | `/api/courses/:id/schedule` | member · lecturer | weekly slots (`weekday`, `start`, `end`, `title`, `place`) and semester dates; changes notify students |
| POST · PUT · DELETE | `/api/courses/:id/events` · `/api/events/:id` | lecturer (own) | one-off events: extra lesson, office hours, meeting, exam, other, or `cancelled` (one occurrence of a slot); upcoming changes notify students |
| GET | `/api/push/public-key` | public | VAPID public key for subscribing (`null` if push isn't configured) |
| POST | `/api/push/subscribe` | any | save this device's push subscription (`PushSubscription.toJSON()`); endpoint must be a known push service |
| POST | `/api/push/unsubscribe` | any | `{ endpoint }` — remove one of your own devices |
| POST | `/api/push/test` | any | send a test notification to all of your devices |

## Questions & suggestions (feed)

Each course has a feed where students post ❓ questions and 💡 suggestions, during class or any time, and
upvote each other's posts. **Anonymous** posts hide the author from other students only; the lecturer always
sees who wrote them. The lecturer marks posts answered, replies (the student gets a push notification),
pins and hides them, and can open a full-screen **projector view** (`/courses/:id/feed/present`) with open
questions sorted by votes and a QR code to join. Posts written without a connection are kept on the phone
and sent automatically when it reconnects (safe to retry: the server de-duplicates by `clientId`). The
export adds a *שאלות והערות* sheet.

## Lesson summaries (local AI)

The lecturer uploads a lesson recording (mp4/m4a/mp3/…) or a Zoom transcript (vtt/srt/txt). Everything runs on
the server machine, free and offline: **ffmpeg** + **whisper.cpp** transcribe Hebrew audio, and a local model
through **Ollama** (default `aya-expanse:8b`) summarizes it in ~10-minute parts, then writes an overview,
review questions and "where students struggled" (using that lesson's feed questions and poll results).
Topic timestamps come from the transcript. Results are drafts: the lecturer edits and publishes; students get a
push notification and a "סיכומים" tab. Recordings are deleted after transcription.

One-time setup (macOS): `brew install ffmpeg whisper-cpp ollama && brew services start ollama`,
`ollama pull aya-expanse:8b`, and download `ggml-large-v3-turbo.bin` from the whisper.cpp models repository into
`~/.cache/class-companion/whisper/`. Settings: `OLLAMA_MODEL`, `OLLAMA_URL`, `WHISPER_MODEL`, `MEDIA_DIR`,
`MAX_UPLOAD_MB` in `server/.env`.

## Assignments & AI homework review (local AI)

- The lecturer creates assignments (instructions, due date, review criteria with points, practice-review limit) and
  publishes them; due dates appear in the agenda.
- Students submit a **PDF or ZIP** (code projects: text/code files and PDFs inside are read; junk folders,
  binaries and hidden files skipped; size and file-count limits). Late submissions are accepted and marked
  with how late they were. Resubmitting replaces the previous final submission.
- **Practice reviews:** before submitting, a student can upload drafts for private AI feedback (limited per
  assignment); the lecturer doesn't see drafts.
- **AI review** (the local model through Ollama, `OLLAMA_MODEL` / `OLLAMA_CODE_MODEL`): per criterion met /
  partial / missing with feedback and a suggestion, strengths and improvements. Suggested points come from the
  verdict (full / half / zero), not from the model. Students also see how the class did on each criterion once
  at least 5 classmates were reviewed (anonymous aggregates only).
- **Compare with the class** (students, after the deadline, 5+ reviewed classmates): the model groups the class
  into anonymous approach patterns (from the reviews only, never submission text), and the student gets a summary
  plus three factual lists from the per-criterion numbers: like most of the class, what most did that you didn't,
  where you stand out. After grades are released (5+ graded), students see the grade distribution with their own
  position.
- **Lecturer:** grading prefilled with the suggestion, comment, original file download, release grades
  (students notified), class overview of common mistakes, and **similar submissions** (shared 5-word
  sequences, works across renamed files) with a side-by-side view. Grades are in the export (*ציונים* sheet).

## Home pages & schedule

- **Lecturer home:** what's live now (open attendance / polls), **today** from the schedule (with a one-tap
  "start attendance" for the class in progress), totals, what needs attention (top open questions, students
  under 70%), and course cards with an attendance trend.
- **Student home:** the week's classes and events of their courses (from the roster), with "check in" for the
  class in progress, plus their courses.
- Each course has a **schedule** (weekly slots + optional semester dates) and **one-off events**; students get
  push notifications when upcoming items are added, changed or cancelled. Times are local (`TIME_ZONE`).
- **Course settings:** rename, default radius, add/remove students, re-upload the roster (merge or replace).
- **Mandatory attendance** (per course, default on): only mandatory courses flag students under 70% in
  "needs attention" (course dashboard and lecturer home).
- **Student signup** requires a university email (`SIGNUP_EMAIL_DOMAINS`, default `msmail.ariel.ac.il`), or any
  email the lecturer put on a course roster.

## Polls

The lecturer creates on-the-spot polls and chooses per poll: the **type** (multiple choice with one or
several answers, yes/no, 1–5 scale, short text), an optional **correct answer**, and **who can answer**
(everyone on the roster, or only students present in the open attendance session). Quick polls
(*הבנתם?*, *קצב השיעור*) open with one tap; drafts can be prepared ahead and reused. Opening a poll notifies
students and shows a banner on their course pages; they can change their answer until it closes. Students
see results (and the correct answer) only when the lecturer reveals them; the projector view
(`/courses/:id/polls/present`) shows live results and a QR code. The export adds *סקרים* and
*תשובות לסקרים* sheets.

## Push notifications

When a lecturer starts attendance, every signed-up student on the roster gets a notification
("הנוכחות נפתחה · <course>") that opens the check-in page. Students turn it on from the course list.

- Needs VAPID keys in `server/.env` (`npx web-push generate-vapid-keys`). Keep the same pair when moving
  servers, or every device must subscribe again.
- **iPhone:** iOS 16.4+, and only from the home-screen app (Safari → Share → Add to Home Screen). The app
  is installed per address, so it must be served from a **fixed** HTTPS URL (Tailscale Funnel, see
  [docs/PHONE_TESTING.md](docs/PHONE_TESTING.md)); a changing tunnel URL breaks installed apps.
- Android Chrome and desktop browsers work without installing.
- Expired subscriptions are removed automatically; logging out unsubscribes the device.

## Attendance rules

- Attendance is stored per **roster email**, so the lecturer can mark students who never signed up; it
  counts for them once they do.
- The lecturer can mark anyone present or absent (live screen or *מפגשים* page), including overriding a GPS
  check-in. A student marked absent can't check in to that session by GPS.

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
