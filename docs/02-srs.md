# Software Requirements Specification (SRS): Class Companion

Version 1.0, 2026-11-24. Structure loosely follows IEEE 830 / ISO/IEC/IEEE 29148.

## 1. Introduction

### 1.1 Purpose

This document specifies the functional and non-functional requirements of Class Companion, a mobile-first web
app for classroom attendance and participation. It is the reference for implementation, testing and acceptance
(see the [Statement of Work](01-sow.md)).

### 1.2 Scope

Class Companion lets a lecturer take location-verified attendance, collect questions and suggestions, run live
polls, publish automatic lesson summaries and review homework with a local AI model. Students use it from their
phones to check in, ask, vote, answer polls, read summaries, and submit homework and get feedback.

### 1.3 Definitions

| Term | Meaning |
|---|---|
| Lecturer | User who owns courses. Created by an administrator (seed script), not by public sign-up. |
| Student | User who belongs to courses through a course roster. |
| Roster | The list of students' emails (and names) for a course, uploaded as a spreadsheet or built by a join link. |
| Session | One attendance window of a course: a centre point, a radius and an end time. |
| Check-in | A student's claim to be present, accepted only from inside the session radius. |
| Post | A question or a suggestion in a course feed. |
| Poll | A question to the class with live results. |
| Submission | A student's file for an assignment: _final_ (graded) or _practice_ (a draft reviewed only by the AI). |
| Review | The AI's structured feedback on a submission, per criterion. |
| PWA | Progressive Web App: a website that can be installed to the home screen and receive notifications. |
| Local model | A language model run by Ollama on the lecturer's machine, with no external service. |

### 1.4 References

- Repository `README.md` (setup) and `docs/PHONE_TESTING.md` (HTTPS for phones).
- [01-sow.md](01-sow.md), [03-use-cases.md](03-use-cases.md), [04-components.md](04-components.md), [05-design.md](05-design.md).

## 2. Overall description

### 2.1 Product perspective

A self-contained client/server system. The browser client talks to a REST API over HTTPS. The server stores data
in MongoDB, stores uploaded files on disk, sends Web Push notifications, and runs whisper.cpp, ffmpeg and Ollama as
local processes for AI features. See [04-components.md](04-components.md).

### 2.2 User classes

| User | Device | Main needs |
|---|---|---|
| Lecturer | Laptop in class, phone or desktop otherwise | Start attendance fast, see who's falling behind, project questions and polls, publish summaries, grade homework |
| Student | Phone | Check in with one tap, ask without embarrassment, see summaries, submit homework and get feedback |
| Visitor | Phone | Join a course from a QR code (demo or open course) |

### 2.3 Operating environment

- Client: current Safari (iOS 16.4+ for push), Chrome, Firefox, Edge; screens from 360 px wide.
- Server: Node.js 22+, MongoDB 7+, macOS (Apple silicon) for the local AI tools.
- HTTPS is required (location and push are only available on secure origins).

### 2.4 Constraints

- C1. No paid services or APIs.
- C2. Recordings and student work stay on the lecturer's machine.
- C3. Interface in Hebrew, right to left.
- C4. Student sign-up limited to `msmail.ariel.ac.il` addresses or emails on a course roster (configurable).

### 2.5 Assumptions

- Students carry a phone with location services turned on during class.
- The lecturer's machine is on and reachable during and after class.

## 3. Functional requirements

Priority: **M** = Must, **S** = Should, **C** = Could. Every requirement below is implemented unless marked _Planned_.

### 3.1 Accounts and access (AUTH)

| ID | Requirement | Pri |
|---|---|---|
| AUTH-1 | A student can sign up with email and password (at least 6 characters). | M |
| AUTH-2 | Sign-up is accepted only for emails in an allowed domain or on any course roster. | M |
| AUTH-3 | Users log in with email and password and receive a token valid for 7 days. | M |
| AUTH-4 | Every API request except sign-up, login and the join page requires a valid token. | M |
| AUTH-5 | Lecturer-only and student-only actions are enforced by role on the server. | M |
| AUTH-6 | A lecturer can only see and change their own courses; a student only courses whose roster has their email. | M |
| AUTH-7 | Passwords are stored as bcrypt hashes. | M |

### 3.2 Courses and rosters (CRS)

| ID | Requirement | Pri |
|---|---|---|
| CRS-1 | A lecturer creates a course by uploading a roster spreadsheet (xlsx/csv) and previewing it before saving. | M |
| CRS-2 | The lecturer can add, remove or replace students on the roster. | M |
| CRS-3 | A student whose email is on a roster sees that course automatically, whenever they sign up. | M |
| CRS-4 | Course settings: name, default attendance radius (5–500 m), mandatory attendance on/off. | M |
| CRS-5 | A lecturer can turn on a join link; anyone with its 6-character code can add themselves with name and email. | S |
| CRS-6 | Joining with an email that already has an account requires that account's password. | M |
| CRS-7 | A lecturer can create a demo course in one click, with the join link open and a lesson happening now. | C |

### 3.3 Attendance (ATT), requirement 1

| ID | Requirement | Pri |
|---|---|---|
| ATT-1 | The lecturer starts a session from their device's location; the reading must be accurate to 100 m or better. | M |
| ATT-2 | A session uses the course's radius, lasts 15 minutes and closes automatically at its end time. | M |
| ATT-3 | The lecturer can close a session early. | M |
| ATT-4 | Rostered students get a push notification when a session opens. | S |
| ATT-5 | A student sees whether they are in range before checking in. | M |
| ATT-6 | The server accepts a check-in only if: the session is active, the student is on the roster, the reading is at most 30 s old and accurate to 100 m, and `distance − studentAccuracy − centreAccuracy ≤ radius`. | M |
| ATT-7 | A student can check in at most once per session. | M |
| ATT-8 | The lecturer can mark any rostered student present or absent, during or after the session. A student marked absent cannot check in. | M |
| ATT-9 | The lecturer sees a live list of who checked in, as a dot grid of the class. | M |
| ATT-10 | Per-course statistics: attendance per session, per student, and students under 70% attendance (only when attendance is mandatory). | M |
| ATT-11 | The lecturer can export attendance (and grades) to an Excel spreadsheet. | M |
| ATT-12 | A student sees their own attendance history and percentage. | S, _Planned_ |

### 3.4 Questions and suggestions (FEED), requirement 2

| ID | Requirement | Pri |
|---|---|---|
| FEED-1 | Students post questions or suggestions (up to 500 characters) to a course feed. | M |
| FEED-2 | A post can be anonymous to other students; the lecturer still sees the author. | M |
| FEED-3 | Students vote posts up, once per post; posts are ordered by votes. | M |
| FEED-4 | The lecturer can reply, mark answered, pin, hide or delete a post. | M |
| FEED-5 | The author is notified when the lecturer replies or marks their post answered. | S |
| FEED-6 | A full-screen projector view shows open questions and suggestions, each labelled, with a QR code to the feed. | S |

### 3.5 Polls (POLL), requirement 3

| ID | Requirement | Pri |
|---|---|---|
| POLL-1 | Poll types: multiple choice (2–6 options, single or multiple answers), yes/no, scale, free text. | M |
| POLL-2 | Optional correct answer for choice and yes/no polls. | S |
| POLL-3 | Audience: the whole roster or only students checked in to the current session. | S |
| POLL-4 | Polls can be saved as drafts, opened, closed, duplicated and deleted. | M |
| POLL-5 | Students are notified when a poll opens and can answer once (changing the answer while it's open). | M |
| POLL-6 | Live results for the lecturer; results shown to students after the lecturer reveals them. | M |
| POLL-7 | A projector view shows results live; free-text answers can be hidden from the screen. | S |
| POLL-8 | Poll results are included in the export. | C |

### 3.6 Lesson summaries (SUM), requirement 4

| ID | Requirement | Pri |
|---|---|---|
| SUM-1 | The lecturer uploads a lesson recording (audio or video). | M |
| SUM-2 | The server transcribes it locally (ffmpeg, whisper.cpp) and writes a summary with the local model, in the background, with progress shown. | M |
| SUM-3 | A summary has: overview, topics with timestamps and key points, key concepts, reminders, likely points of confusion, review questions. | M |
| SUM-4 | The lecturer edits the draft and publishes it; students are notified and can read published summaries only. | M |
| SUM-5 | A failed job can be retried; jobs interrupted by a restart resume automatically. | S |
| SUM-6 | Importing recordings directly from Zoom. | C, _Planned_ |

### 3.7 Assignments and homework review (ASG), requirement 5

| ID | Requirement | Pri |
|---|---|---|
| ASG-1 | The lecturer creates an assignment: title, instructions, due date, criteria with points, number of practice reviews (0–10); as a draft or published (students notified). | M |
| ASG-2 | Students submit a PDF or ZIP (up to 50 MB). Text is extracted from PDFs and from code and text files in ZIPs (junk folders and binaries skipped). Any PDF is accepted; without text the AI review is skipped. | M |
| ASG-3 | Submissions after the due date are accepted and marked late by how long. | M |
| ASG-4 | Each final submission is reviewed by the local model per criterion: met / partial / not met, feedback, suggestion, plus overall strengths and improvements. | M |
| ASG-5 | Suggested points are derived from each verdict (full, half, zero); the lecturer sets the final grade. | M |
| ASG-6 | Practice reviews: before submitting, a student can get private AI feedback on a draft, up to the assignment's limit, and submit a reviewed draft as final. | S |
| ASG-7 | The lecturer grades per criterion with a comment, and releases grades; students see grades only after release and are notified. | M |
| ASG-8 | The lecturer can generate a class overview (common issues, strengths) and run a similarity check between submissions. | S |
| ASG-9 | Students see, per criterion, what share of the class met it, once at least 5 classmates were reviewed. | S |
| ASG-10 | After the deadline, a student can request a comparison with the class built only from anonymous review summaries, never from other students' text. | S |
| ASG-11 | After grades are released (at least 5 graded), students see the grade distribution with their own position. | S |

### 3.8 Schedule and home pages (HOME)

| ID | Requirement | Pri |
|---|---|---|
| HOME-1 | A course has weekly lesson slots and one-off events (extra lesson, cancellation, office hours, exam…). | S |
| HOME-2 | Students and lecturers see an agenda of upcoming lessons, events and assignment deadlines across their courses. | S |
| HOME-3 | Students are notified when a course schedule changes. | S |
| HOME-4 | The lecturer home shows: the live session or the next lesson, today's recap, items that need action (unanswered questions, students at risk, submissions to grade), and their courses. | S |

### 3.9 Notifications (PUSH)

| ID | Requirement | Pri |
|---|---|---|
| PUSH-1 | Users can turn push notifications on per device, and send a test notification. | S |
| PUSH-2 | Notifications are sent for: attendance opened, poll opened, reply to a post, schedule change, new assignment, review ready, grades released, summary published. | S |

## 4. External interface requirements

### 4.1 User interface

- Hebrew, right to left; Secular One and IBM Plex Sans Hebrew fonts; light and dark themes.
- Layout works from 360 px phones to desktop; lecturer screens for projecting (polls, questions, demo QR).
- Errors from the server are shown in Hebrew with a reason and, where possible, what to do.

### 4.2 Software interfaces

| Interface | Use |
|---|---|
| REST API (`/api/*`, JSON over HTTPS) | Client ↔ server |
| Browser Geolocation API | Lecturer and student location |
| Web Push (VAPID) + service worker | Notifications |
| MongoDB | Persistence |
| ffmpeg, whisper.cpp (CLI) | Audio extraction, transcription |
| Ollama HTTP API (`127.0.0.1:11434`) | Summaries, reviews, class patterns |

### 4.3 Communication

All traffic is HTTPS (Tailscale Funnel in development). The server listens only on localhost; Ollama is not exposed.

## 5. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Responsiveness | AI work (transcription, summaries, reviews, comparisons) runs in a background queue, one job at a time, and never blocks other requests; the client shows progress and is notified when a job finishes. |
| NFR-2 | Security | Role and ownership checks on every route; uploads size-limited; ZIP limits (500 entries, 80 MB unpacked, 2 MB per file); push endpoints restricted to known push services. |
| NFR-3 | Privacy | Anonymous posts hide the author from classmates; class comparisons and grade distributions are anonymous and need at least 5 students; no data leaves the host. |
| NFR-4 | Reliability | Background jobs survive a server restart and resume; uniqueness of check-ins and final submissions enforced by database indexes. |
| NFR-5 | Usability | Check-in is one tap after the page opens; the location permission prompt is triggered from a tap, with an explanation when location is blocked or approximate. |
| NFR-6 | Maintainability | TypeScript strict mode on client and server; attendance rules shared between client and server (`shared/`). |
| NFR-7 | Testability | Automated API tests with an in-memory database and a fake model; tests never touch the real database or ports. |
| NFR-8 | Portability | Installable PWA on iOS and Android; runs in any modern desktop browser. |

## 6. Traceability to the assignment requirements

| Assignment requirement | SRS section | Use cases |
|---|---|---|
| 1. Attendance plus spreadsheet | 3.3 | UC-2, UC-3, UC-4, UC-5 |
| 2. Student comments and suggestions | 3.4 | UC-6, UC-7 |
| 3. Polls | 3.5 | UC-8, UC-9 |
| 4. ML summary of class video | 3.6 | UC-10, UC-11 |
| 5. LLM homework review and comparison | 3.7 | UC-12 to UC-16 |
