# Low-Level Design: Class and Sequence Diagrams

The server is written in TypeScript with Mongoose. Persistent entities are Mongoose models (shown as classes
with their fields); behaviour lives in routers and service modules (shown as classes with the `<<router>>`,
`<<service>>` or `<<module>>` stereotype and their main functions). Diagrams use Mermaid, which GitHub renders.

## 1. Class diagrams

### 1.1 Domain model

```mermaid
classDiagram
  direction LR

  class User {
    +ObjectId _id
    +String email
    +String passwordHash
    +Role role
    +String firstName
    +String lastName
  }

  class Course {
    +ObjectId _id
    +String name
    +ObjectId lecturerId
    +List~RosterEntry~ roster
    +Number defaultRadiusM
    +Boolean attendanceRequired
    +List~ScheduleSlot~ schedule
    +String semesterStart
    +String semesterEnd
    +String joinCode
    +Boolean joinOpen
    +Boolean demo
  }

  class RosterEntry {
    +String email
    +String firstName
    +String lastName
    +Date joinedAt
  }

  class ScheduleSlot {
    +String id
    +Number weekday
    +String start
    +String end
    +String title
    +String place
  }

  class CourseEvent {
    +ObjectId courseId
    +EventKind kind
    +String date
    +String start
    +String end
    +String title
    +String slotId
  }

  class Session {
    +ObjectId courseId
    +GeoPoint center
    +Number centerAccuracyM
    +Number radiusM
    +Date startsAt
    +Date endsAt
    +SessionStatus status
  }

  class Attendance {
    +ObjectId sessionId
    +String email
    +ObjectId studentId
    +Boolean present
    +Date checkedInAt
    +Number distanceM
    +Number accuracyM
    +Source source
  }

  class Post {
    +ObjectId courseId
    +ObjectId authorId
    +PostKind kind
    +String text
    +Boolean anonymous
    +List~ObjectId~ voterIds
    +PostStatus status
    +Boolean pinned
    +Boolean hidden
    +Reply reply
  }

  class Poll {
    +ObjectId courseId
    +String question
    +PollType type
    +Boolean multiple
    +List~Option~ options
    +List~String~ correctOptionIds
    +Audience audience
    +PollStatus status
    +Boolean resultsRevealed
    +ObjectId sessionId
  }

  class PollResponse {
    +ObjectId pollId
    +String email
    +ObjectId studentId
    +List~String~ optionIds
    +Number value
    +String text
  }

  class LessonSummary {
    +ObjectId courseId
    +String date
    +String title
    +SummaryStatus status
    +Number progress
    +String mediaPath
    +List~Segment~ transcript
    +SummaryContent content
    +Date publishedAt
  }

  class Assignment {
    +ObjectId courseId
    +String title
    +String instructions
    +Date dueAt
    +Number maxPoints
    +List~Criterion~ criteria
    +Number practiceLimit
    +AssignmentStatus status
    +Boolean gradesReleased
    +ClassOverview classOverview
    +ClassPatterns classPatterns
  }

  class Criterion {
    +String id
    +String title
    +String description
    +Number points
  }

  class Submission {
    +ObjectId assignmentId
    +String email
    +ObjectId studentId
    +SubmissionKind kind
    +String fileName
    +String storedPath
    +List~ExtractedFile~ files
    +Date submittedAt
    +Number lateMs
    +Review review
    +Grade grade
    +Comparison comparison
  }

  class Review {
    +ReviewStatus status
    +String summary
    +String approach
    +List~String~ strengths
    +List~String~ improvements
    +List~CriterionReview~ criteria
    +String model
  }

  class Grade {
    +Number points
    +List~CriterionPoints~ criteria
    +String comment
    +Date gradedAt
  }

  class PushSubscription {
    +ObjectId userId
    +String endpoint
    +Keys keys
  }

  User "1" --> "0..*" Course : teaches
  Course "1" *-- "0..*" RosterEntry : roster
  Course "1" *-- "0..*" ScheduleSlot : schedule
  RosterEntry ..> User : matched by email
  Course "1" --> "0..*" CourseEvent
  Course "1" --> "0..*" Session
  Session "1" --> "0..*" Attendance
  Course "1" --> "0..*" Post
  User "1" --> "0..*" Post : writes
  Course "1" --> "0..*" Poll
  Poll "1" --> "0..*" PollResponse
  Poll "0..*" --> "0..1" Session : present-only audience
  Course "1" --> "0..*" LessonSummary
  Course "1" --> "0..*" Assignment
  Assignment "1" *-- "1..*" Criterion
  Assignment "1" --> "0..*" Submission
  Submission "1" *-- "1" Review
  Submission "1" *-- "0..1" Grade
  User "1" --> "0..*" Submission : submits
  User "1" --> "0..*" PushSubscription : devices
```

**Constraints enforced by indexes**
- `Attendance`: unique (`sessionId`, `email`): one record per student per session.
- `Submission`: unique (`assignmentId`, `email`) where `kind = final`: one final submission per student.
- `PollResponse`: unique (`pollId`, `email`): one answer per student per poll.
- `Course`: unique `joinCode` when set.
- `User`: unique `email`.

**Enumerations**

| Enum | Values |
|---|---|
| Role | `lecturer`, `student` |
| SessionStatus | `active`, `closed` |
| Source (attendance) | `gps`, `manual` |
| PostKind / PostStatus | `question`, `suggestion` / `open`, `answered` |
| PollType / PollStatus / Audience | `choice`, `yesno`, `scale`, `text` / `draft`, `open`, `closed` / `roster`, `present` |
| SummaryStatus | `queued`, `transcribing`, `summarizing`, `draft`, `published`, `failed` |
| SubmissionKind | `final`, `practice` |
| ReviewStatus | `queued`, `running`, `done`, `failed`, `skipped` |
| EventKind | `extra`, `cancelled`, `office`, `meeting`, `exam`, `other` |

### 1.2 Attendance: services and rules

```mermaid
classDiagram
  direction LR

  class sessionsRouter {
    <<router>>
    +GET /:id
    +POST /:id/close
    +GET /:id/roster
    +PUT /:id/attendance
    +POST /:id/range
    +POST /:id/check-in
    -checkStudentReading(sessionId, studentId, body) Verdict
  }

  class coursesRouter {
    <<router>>
    +POST /:id/sessions
    +GET /:id/sessions/active
    +GET /:id/dashboard
    +GET /:id/export
  }

  class AttendanceRules {
    <<module shared/attendance>>
    +ATTENDANCE_RULES
    +isInRange(distanceM, studentAccuracyM, centerAccuracyM, radiusM) Boolean
    +evaluateRange(student, center, radiusM) RangeResult
    +isPreciseEnoughToStart(accuracyM) Boolean
    +isPreciseEnoughToCheckIn(accuracyM) Boolean
    +isFresh(timestamp, now) Boolean
  }

  class Geo {
    <<module shared/geo>>
    +EARTH_RADIUS_M
    +haversineM(a, b) Number
  }

  class SessionService {
    <<service lib/sessions>>
    +closeExpiredSessions(filter)
    +toPublicSession(session)
  }

  class Stats {
    <<service lib/stats>>
    +buildStudentRows(roster, users, sessions, attendance, now) List~StudentRow~
    +buildDashboard(roster, users, sessions, attendance, now, attendanceRequired) Dashboard
  }

  class Push {
    <<service lib/push>>
    +notifyUsers(userIds, payload)
    +notifyCourseStudents(course, payload)
    +announceSessionStarted(course)
  }

  class Export {
    <<service lib/export>>
    +buildCourseWorkbook(courseName, roster, users, sessions, records, posts, polls, assignments) Workbook
  }

  sessionsRouter ..> AttendanceRules
  sessionsRouter ..> SessionService
  sessionsRouter ..> Session
  sessionsRouter ..> Attendance
  coursesRouter ..> AttendanceRules
  coursesRouter ..> Push
  coursesRouter ..> Stats
  coursesRouter ..> Export
  AttendanceRules ..> Geo

  class Session {
    <<model>>
  }
  class Attendance {
    <<model>>
  }
```

### 1.3 AI features: summaries and homework review

```mermaid
classDiagram
  direction LR

  class LlmClient {
    <<interface>>
    +call(system, user, schema, model) Promise~unknown~
  }
  class ollamaClient {
    <<LlmClient>>
  }
  class FakeLlm {
    <<LlmClient, tests>>
  }
  LlmClient <|.. ollamaClient
  LlmClient <|.. FakeLlm

  class JobQueue {
    <<service lib/jobs>>
    -Promise chain
    +enqueueJob(name, job) Promise
    +settleJobs() Promise
  }

  class SummaryPipeline {
    <<service summaries/pipeline>>
    +enqueueSummary(summaryId)
    +resumeSummaryJobs()
    +setSummaryEngines(engines)
  }
  class Transcriber {
    <<service summaries/transcribe>>
    +whisperTranscriber(mediaPath) List~Segment~
  }
  class Summarizer {
    <<service summaries/summarize>>
    +summarizeLesson(segments, context, llm) SummaryContent
  }
  class Transcript {
    <<module summaries/transcript>>
    +chunkTranscript(segments, budget) List~Chunk~
    +formatTime(seconds) String
  }

  class assignmentsRouter {
    <<router>>
    +POST /assignments/:aid/submissions
    +POST /submissions/:sid/submit
    +POST /submissions/:sid/compare
    +PUT /submissions/:sid/grade
    +POST /assignments/:aid/overview
    +GET /assignments/:aid/similarity
    -enqueueReview(submissionId)
    -classShares(assignment, excludeEmail)
    -gradeStatsFor(assignment)
  }
  class Extractor {
    <<service assignments/extract>>
    +extractSubmission(fileName, data) List~ExtractedFile~
    +pdfText(data) String
    +isCodeSubmission(files) Boolean
  }
  class Reviewer {
    <<service assignments/review>>
    +reviewSubmission(assignment, files, llm, code) ReviewResult
    +normalizeReview(raw, criteria) ReviewResult
    +classOverview(assignment, reviews, llm)
    +classPatterns(assignment, reviews, llm) ClassPatterns
    +compareToClass(assignment, mine, patterns, shares, size, llm) Comparison
    +gradeStats(points, maxPoints) GradeStats
  }
  class Similarity {
    <<service assignments/similarity>>
    +shingles(text) Set
    +jaccard(a, b) Number
    +similarPairs(items, threshold) List~SimilarPair~
  }

  SummaryPipeline ..> JobQueue
  SummaryPipeline ..> Transcriber
  SummaryPipeline ..> Summarizer
  Summarizer ..> Transcript
  Summarizer ..> LlmClient
  assignmentsRouter ..> JobQueue
  assignmentsRouter ..> Extractor
  assignmentsRouter ..> Reviewer
  assignmentsRouter ..> Similarity
  Reviewer ..> LlmClient
```

`LlmClient` is the seam that keeps AI features testable: production code receives `ollamaClient`, while tests
inject a fake through `setReviewLlm` / `setSummaryEngines`, so tests are fast and deterministic.

## 2. Sequence diagrams

### 2.1 Start attendance (UC-2)

```mermaid
sequenceDiagram
  autonumber
  actor L as Lecturer
  participant C as Client (LecturerAttendance)
  participant G as Geolocation API
  participant R as coursesRouter
  participant DB as MongoDB
  participant P as Push service

  L->>C: Tap "start attendance"
  C->>G: watchPosition(highAccuracy)
  G-->>C: lat, lng, accuracy
  C->>C: isPreciseEnoughToStart(accuracy)
  L->>C: Confirm
  C->>R: POST /courses/:id/sessions {lat, lng, accuracy}
  R->>DB: findOwnCourse(id, lecturer)
  R->>DB: closeExpiredSessions, find active session
  alt a session is already active
    R-->>C: 409 + existing session
    C->>C: Open the existing session
  else no active session
    R->>DB: Session.create(center, radius, endsAt = now + 15 min)
    R-->>C: 201 session
    R-)P: notifyCourseStudents("attendance opened")
    C->>C: Show live screen, poll GET /sessions/:id every few seconds
  end
```

### 2.2 Student check-in (UC-3)

```mermaid
sequenceDiagram
  autonumber
  actor S as Student
  participant C as Client (StudentCheckIn)
  participant G as Geolocation API
  participant R as sessionsRouter
  participant AR as AttendanceRules
  participant DB as MongoDB

  S->>C: Tap "allow location"
  C->>G: watchPosition(highAccuracy)
  loop each new reading
    G-->>C: lat, lng, accuracy, timestamp
    C->>R: POST /sessions/:id/range {reading}
    R->>DB: closeExpiredSessions, load session, check roster
    R->>AR: evaluateRange(student, center, radius)
    AR-->>R: distanceM, inRange
    R-->>C: inRange, distanceM, alreadyCheckedIn
  end
  S->>C: Tap "I'm here"
  C->>R: POST /sessions/:id/check-in {fresh reading}
  R->>AR: isPreciseEnoughToCheckIn, isFresh, evaluateRange
  alt reading too old or imprecise
    R-->>C: 400 with reason
  else out of range
    R-->>C: 403 Not in range, distanceM
  else marked absent by lecturer
    R-->>C: 403 Marked absent
  else already checked in
    R-->>C: 409 checkedInAt
  else valid
    R->>DB: Attendance.create(source gps, distance, accuracy)
    Note over DB: unique (sessionId, email) stops a double check-in race
    R-->>C: 201 checkedInAt
    C-->>S: "You're checked in"
  end
```

### 2.3 Run and answer a poll (UC-8, UC-9)

```mermaid
sequenceDiagram
  autonumber
  actor L as Lecturer
  actor S as Student
  participant C as Client
  participant R as pollsRouter
  participant PL as lib/polls
  participant DB as MongoDB
  participant P as Push service

  L->>C: Write question and options, tap "open"
  C->>R: POST /courses/:id/polls {question, type, options, open: true}
  R->>PL: readPollInput(body)
  PL-->>R: valid input
  alt audience = present and no active session
    R-->>C: 409 Attendance is not open
  else
    R->>DB: Poll.save(status open)
    R-)P: notify audience "new poll"
    R-->>C: 201 poll
  end
  P-->>S: Notification
  S->>C: Pick an answer
  C->>R: PUT /polls/:pollId/response {optionIds}
  R->>PL: readResponse(poll, body)
  R->>DB: upsert PollResponse(pollId, email)
  R-->>C: 200
  loop projector view, every few seconds
    C->>R: GET /courses/:id/polls
    R->>PL: aggregate(poll, responses)
    R-->>C: live results
  end
  L->>C: Close and reveal
  C->>R: POST /polls/:pollId/close, POST /polls/:pollId/reveal
```

### 2.4 Lesson summary from a recording (UC-10)

```mermaid
sequenceDiagram
  autonumber
  actor L as Lecturer
  participant C as Client (CourseSummaries)
  participant R as summariesRouter
  participant Q as JobQueue
  participant T as Transcriber
  participant SM as Summarizer
  participant O as Ollama
  participant DB as MongoDB

  L->>C: Upload recording
  C->>R: POST /courses/:id/summaries (raw file, progress bar)
  R->>DB: LessonSummary.create(status queued, mediaPath)
  R->>Q: enqueueSummary(id)
  R-->>C: 201 summary
  Q->>DB: status transcribing
  Q->>T: whisperTranscriber(mediaPath)
  T->>T: ffmpeg to 16 kHz mono WAV, then whisper.cpp
  T-->>Q: timestamped segments
  Q->>DB: status summarizing, save transcript
  Q->>SM: summarizeLesson(segments)
  loop each chunk that fits the model context
    SM->>O: chat(prompt, JSON schema)
    O-->>SM: partial summary
  end
  SM->>O: merge partial summaries
  O-->>SM: overview, topics, concepts, reminders, questions
  Q->>DB: status draft, content
  loop until done
    C->>R: GET /summaries/:id
    R-->>C: status, progress
  end
  L->>C: Edit and publish
  C->>R: PUT /summaries/:id, POST /summaries/:id/publish
  R-)R: notify students "new lesson summary"
```

### 2.5 Submit homework and AI review (UC-14)

```mermaid
sequenceDiagram
  autonumber
  actor S as Student
  participant C as Client (AssignmentDetail)
  participant R as assignmentsRouter
  participant X as Extractor
  participant Q as JobQueue
  participant RV as Reviewer
  participant O as Ollama
  participant DB as MongoDB
  participant FS as Disk

  S->>C: Choose PDF or ZIP
  C->>R: POST /assignments/:aid/submissions?kind=final&fileName=hw.pdf
  R->>R: readBody (max 50 MB)
  R->>X: extractSubmission(fileName, data)
  alt unsupported type or unreadable ZIP
    X-->>R: ExtractError
    R-->>C: 400 with reason
  else text extracted (or a PDF without text)
    X-->>R: files
    R->>DB: replace earlier final, lateMs = max(0, now - dueAt), review queued
    R->>FS: write original file
    R->>Q: enqueueReview(id)
    R-->>C: 201 submission
  end
  alt no text (scanned PDF)
    Q->>DB: review skipped
  else
    Q->>RV: reviewSubmission(assignment, files, llm)
    RV->>O: chat(rubric prompt, JSON schema per criterion)
    O-->>RV: verdicts, feedback, approach
    RV->>RV: normalizeReview: points from verdicts
    Q->>DB: review done
    Q-)S: push "feedback is ready"
  end
```

### 2.6 Compare with the class (UC-16)

```mermaid
sequenceDiagram
  autonumber
  actor S as Student
  participant C as Client
  participant R as assignmentsRouter
  participant Q as JobQueue
  participant RV as Reviewer
  participant O as Ollama
  participant DB as MongoDB

  S->>C: Tap "compare with the class"
  C->>R: POST /submissions/:sid/compare
  alt before deadline
    R-->>C: 409 opens after the deadline
  else own review not done or fewer than 5 reviewed classmates
    R-->>C: 409 with reason
  else
    R->>DB: comparison queued
    R->>Q: enqueue comparison
    R-->>C: 202
    Q->>DB: load reviews of all final submissions (no file text)
    opt class patterns missing or outdated
      Q->>RV: classPatterns(reviews)
      RV->>O: group approaches, common strengths and gaps
      Q->>DB: save classPatterns on the assignment
    end
    Q->>R: classShares (percent per criterion, excluding the student)
    Q->>RV: compareToClass(mine, patterns, shares)
    RV->>RV: lists from per-criterion facts
    RV->>O: summary paragraph only
    Q->>DB: comparison done
  end
  C->>R: GET /assignments/:aid (polling)
  R-->>C: comparison
```

### 2.7 Join a course with a QR code (UC-17)

```mermaid
sequenceDiagram
  autonumber
  actor V as Visitor
  participant C as Client (JoinCourse)
  participant R as joinRouter
  participant DB as MongoDB

  V->>C: Scan QR, open /join/CODE
  C->>R: GET /join/CODE
  R->>DB: Course where joinCode = CODE and joinOpen
  R-->>C: course name, lecturer
  V->>C: Name, email (optional password), tap "join"
  C->>R: POST /join/CODE
  alt email has an account
    alt no or wrong password
      R-->>C: 409 or 401 needsPassword
      C-->>V: Ask for that account's password
    else correct password, student role
      R->>DB: add to roster if missing
      R-->>C: 201 token, user, courseId
    end
  else new email
    R->>DB: User.create(student, hashed password)
    R->>DB: updateOne roster push where email not present
    R-->>C: 201 token, user, courseId
  end
  C->>C: acceptSession(token), open the course
```
