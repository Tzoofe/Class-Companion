import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';
import AuthForm from './pages/AuthForm';
import CourseDashboard from './pages/CourseDashboard';
import AssignmentDetail from './pages/AssignmentDetail';
import CourseAssignments from './pages/CourseAssignments';
import CourseFeed from './pages/CourseFeed';
import CoursePolls from './pages/CoursePolls';
import CourseSchedulePage from './pages/CourseSchedulePage';
import CourseSessions from './pages/CourseSessions';
import CourseSettings from './pages/CourseSettings';
import CourseStudents from './pages/CourseStudents';
import CourseSummaries from './pages/CourseSummaries';
import Courses from './pages/Courses';
import LecturerAttendance from './pages/LecturerAttendance';
import DebugLocation from './pages/DebugLocation';
import DemoScreen from './pages/DemoScreen';
import JoinCourse from './pages/JoinCourse';
import FeedPresent from './pages/FeedPresent';
import NewCourse from './pages/NewCourse';
import PollPresent from './pages/PollPresent';
import SessionDetail from './pages/SessionDetail';
import SummaryDetail from './pages/SummaryDetail';
import SubmissionDetail, { CompareSubmissions } from './pages/SubmissionDetail';
import StudentCheckIn from './pages/StudentCheckIn';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<AuthForm mode="login" />} />
        <Route path="/signup" element={<AuthForm mode="signup" />} />
        <Route path="/debug/location" element={<DebugLocation />} />
        <Route path="/join/:code" element={<JoinCourse />} />
        <Route element={<RequireAuth />}>
          <Route element={<RequireAuth role="lecturer" />}>
            <Route path="/courses/:id/feed/present" element={<FeedPresent />} />
            <Route path="/courses/:id/polls/present" element={<PollPresent />} />
            <Route path="/courses/:id/demo" element={<DemoScreen />} />
          </Route>
          <Route element={<Layout />}>
            <Route path="/courses" element={<Courses />} />
            <Route path="/courses/:id/feed" element={<CourseFeed />} />
            <Route path="/courses/:id/polls" element={<CoursePolls />} />
            <Route path="/courses/:id/summaries" element={<CourseSummaries />} />
            <Route path="/courses/:id/summaries/:summaryId" element={<SummaryDetail />} />
            <Route path="/courses/:id/assignments" element={<CourseAssignments />} />
            <Route path="/courses/:id/assignments/:aid" element={<AssignmentDetail />} />
            <Route element={<RequireAuth role="student" />}>
              <Route path="/courses/:id/checkin" element={<StudentCheckIn />} />
            </Route>
            <Route element={<RequireAuth role="lecturer" />}>
              <Route path="/courses/new" element={<NewCourse />} />
              <Route path="/courses/:id" element={<CourseDashboard />} />
              <Route path="/courses/:id/students" element={<CourseStudents />} />
              <Route path="/courses/:id/sessions" element={<CourseSessions />} />
              <Route path="/courses/:id/settings" element={<CourseSettings />} />
              <Route path="/courses/:id/schedule" element={<CourseSchedulePage />} />
              <Route path="/courses/:id/assignments/:aid/submissions/:sid" element={<SubmissionDetail />} />
              <Route path="/courses/:id/assignments/:aid/compare" element={<CompareSubmissions />} />
              <Route path="/courses/:id/sessions/:sessionId" element={<SessionDetail />} />
              <Route path="/courses/:id/attendance" element={<LecturerAttendance />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/courses" replace />} />
      </Routes>
    </AuthProvider>
  );
}
