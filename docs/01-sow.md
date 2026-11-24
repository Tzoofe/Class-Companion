# Statement of Work (SoW): Class Companion

| | |
|---|---|
| **Project** | Class Companion: classroom attendance and participation app |
| **Course** | Introduction to Software Engineering, Ariel University |
| **Team** | Tzoofe Cohen |
| **Version** | 1.0, 2026-11-24 |

## 1. Background

In a university lecture, attendance is still taken with paper sign-in sheets or by reading names aloud. Both
waste class time and are easy to cheat, since a friend can sign for someone who isn't there. Students who don't
understand something rarely say so in a room of 100 people, and the lecturer has no quick way to check whether
the class is following. After class, students who missed a lesson have no summary to catch up from. Homework
feedback arrives days or weeks after submission, when it's too late to act on.

Class Companion is a mobile-first web app (a PWA, installable on a phone's home screen) that addresses these
problems for lecturers and students in one place.

## 2. Objectives

1. **Fast attendance that's hard to fake.** Students check in from their phone, and the server accepts the
   check-in only when the phone's location is inside the classroom radius set by the lecturer.
2. **Give quiet students a voice.** Questions and suggestions, optionally anonymous to classmates, voted up by
   the class; live polls with results on the projector.
3. **Help students catch up.** An automatic summary of each lesson, generated from the lesson recording.
4. **Faster, more useful homework feedback.** An AI review of every submission against the lecturer's criteria,
   practice reviews before the deadline, and an anonymous comparison with the class afterwards.
5. **Zero running cost and privacy.** No paid services: speech recognition and language models run locally on
   the lecturer's machine, so recordings and student work never leave it.

## 3. Scope

### 3.1 In scope

| # | Area | Summary |
|---|---|---|
| 1 | Attendance | Location-based check-in, manual marking by the lecturer, per-course statistics, export to a spreadsheet |
| 2 | Comments and suggestions | Course feed of questions and suggestions, voting, anonymity, lecturer replies, projector view |
| 3 | Polls | Multiple-choice, yes/no, scale and free-text polls, live results, projector view |
| 4 | Lesson summaries | Upload a lesson recording; local transcription and a local language model write a summary the lecturer edits and publishes |
| 5 | Homework review | PDF/ZIP submissions, AI review per criterion, practice reviews, grading, class overview, similarity check, comparison with the class |
| | Supporting features | Accounts and roles, courses and rosters, schedules and agenda, home dashboards, push notifications, join link with QR code, demo mode |

### 3.2 Out of scope (this version)

- Pulling recordings directly from Zoom or Google Meet (recordings are uploaded instead; Zoom OAuth is planned).
- Integration with the university's student information system or Moodle.
- Native iOS or Android apps (the PWA covers phones).
- Password reset by email.
- Public cloud hosting (the app runs on the lecturer's Mac, exposed over HTTPS through Tailscale Funnel; a move
  to Firebase Hosting is planned).

## 4. Deliverables

| # | Deliverable | Form |
|---|---|---|
| D1 | Working application: React client and Node.js server | Git repository |
| D2 | Automated test suite (server API and logic) | `server/tests`, run with `npm test` |
| D3 | Statement of Work | This document |
| D4 | Software Requirements Specification | [02-srs.md](02-srs.md) |
| D5 | Use cases and user stories | [03-use-cases.md](03-use-cases.md) |
| D6 | Software components | [04-components.md](04-components.md) |
| D7 | Class and sequence diagrams | [05-design.md](05-design.md) |
| D8 | Setup and phone-testing guide | `README.md`, `docs/PHONE_TESTING.md` |

## 5. Approach and milestones

The work is delivered in short increments, each ending with a working, tested feature committed to the repository.

| Milestone | Content | Status |
|---|---|---|
| M1 | Accounts, courses, roster upload, location-based attendance, manual marking, export | Done (2026-11-22 to 11-24) |
| M2 | Push notifications, course dashboard, questions and suggestions feed | Done (2026-11-23 to 11-24) |
| M3 | Live polls, home pages, schedules, sign-up restricted to university email | Done (2026-11-24) |
| M4 | Lesson summaries with local transcription and a local model | Done (2026-11-24) |
| M5 | Assignments with AI review, grading, comparison with the class | Done (2026-11-24) |
| M6 | Demo mode with QR join | Done (2026-11-24) |
| M7 | Engineering documents (SoW, SRS, use cases, components, design) | In progress |
| M8 | Zoom recording import, Firebase hosting | Planned |

## 6. Technical approach

- **Client:** React 19, TypeScript, Vite, Tailwind CSS v4; installable PWA with a service worker for push
  notifications. Hebrew, right-to-left interface; light and dark themes.
- **Server:** Node.js, Express 5, TypeScript, Mongoose 9 on MongoDB; JWT authentication with lecturer and
  student roles.
- **Local AI:** whisper.cpp (`large-v3-turbo`) and ffmpeg for transcription; Ollama with `aya-expanse:8b` for
  summaries and homework reviews.
- **Quality:** Vitest with an in-memory MongoDB and supertest; strict TypeScript on client and server.

## 7. Assumptions and constraints

- Students have a smartphone with location services and a modern browser (Safari on iOS, Chrome on Android).
- Location features require HTTPS, so the app is always served over HTTPS (Tailscale Funnel in development).
- The lecturer's machine runs the server and the local AI models.
- No paid APIs or services may be used.
- Sign-up is limited to university email addresses (`msmail.ariel.ac.il`) or to emails on an uploaded course roster.

## 8. Acceptance criteria

The project is accepted when:

1. Every requirement in the SRS marked _Must_ is implemented and demonstrated.
2. The automated test suite passes, and the client and server type-check without errors.
3. The five features of section 3.1 can be shown end to end in a live demo with real phones.
4. The documents D3 to D7 are complete and consistent with the code.

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Indoor GPS is imprecise | Present students rejected | Accuracy circles of both the lecturer's and the student's readings count in the student's favour; manual marking by the lecturer |
| Location spoofing | False attendance | Server-side range check with a fresh reading (at most 30 s old); lecturer can mark a student absent, which blocks later check-in |
| Local model quality (Hebrew, code) | Weak feedback | Structured JSON output; points derived from verdicts, not model arithmetic; the lecturer always sets the final grade |
| One machine hosts everything | Downtime when the laptop sleeps | Planned move to Firebase hosting |
| Privacy of student work | Leaks between students | Comparison uses only anonymous review summaries, never another student's text; at least 5 classmates needed |
