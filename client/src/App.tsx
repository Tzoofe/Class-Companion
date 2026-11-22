import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';
import AuthForm from './pages/AuthForm';
import CourseDetail from './pages/CourseDetail';
import Courses from './pages/Courses';
import DebugLocation from './pages/DebugLocation';
import NewCourse from './pages/NewCourse';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<AuthForm mode="login" />} />
        <Route path="/signup" element={<AuthForm mode="signup" />} />
        <Route path="/debug/location" element={<DebugLocation />} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/courses" element={<Courses />} />
            <Route element={<RequireAuth role="lecturer" />}>
              <Route path="/courses/new" element={<NewCourse />} />
              <Route path="/courses/:id" element={<CourseDetail />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/courses" replace />} />
      </Routes>
    </AuthProvider>
  );
}
