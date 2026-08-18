import { lazy, Suspense } from "react";
import { readBootstrap } from "./lib/bootstrap.js";

const AdminDashboard = lazy(async () => ({
  default: (await import("./features/admin/dashboard.js")).AdminDashboard
}));
const AdminSetupPage = lazy(async () => ({
  default: (await import("./features/admin/setup.js")).AdminSetupPage
}));
const ServiceStatusPage = lazy(async () => ({
  default: (await import("./features/admin/setup.js")).ServiceStatusPage
}));
const TeacherDashboard = lazy(async () => ({
  default: (await import("./features/instructor/dashboard.js")).TeacherDashboard
}));
const AuthorizationPage = lazy(async () => ({
  default: (await import("./features/seb/authorization.js")).AuthorizationPage
}));
const StudentSessionAuthorizationPage = lazy(async () => ({
  default: (await import("./features/seb/authorization.js")).StudentSessionAuthorizationPage
}));
const StudentSessionConnectedPage = lazy(async () => ({
  default: (await import("./features/seb/authorization.js")).StudentSessionConnectedPage
}));
const CanvasOAuthConnectedPage = lazy(async () => ({
  default: (await import("./features/seb/authorization.js")).CanvasOAuthConnectedPage
}));
const OAuthErrorPage = lazy(async () => ({
  default: (await import("./features/seb/authorization.js")).OAuthErrorPage
}));
const SebDownloadPage = lazy(async () => ({
  default: (await import("./features/seb/launch.js")).SebDownloadPage
}));
const SebLaunchingPage = lazy(async () => ({
  default: (await import("./features/seb/launch.js")).SebLaunchingPage
}));
const SebLaunchingHandoffPage = lazy(async () => ({
  default: (await import("./features/seb/launch.js")).SebLaunchingHandoffPage
}));
const SebExitPage = lazy(async () => ({
  default: (await import("./features/seb/exit.js")).SebExitPage
}));
const SebQuitPage = lazy(async () => ({
  default: (await import("./features/seb/exit.js")).SebQuitPage
}));
const SebSetupCheckPage = lazy(async () => ({
  default: (await import("./features/seb/setup-check.js")).SebSetupCheckPage
}));
const StudentDashboard = lazy(async () => ({
  default: (await import("./features/student/index.js")).StudentDashboard
}));

const bootstrap = readBootstrap();

export function App() {
  return <Suspense fallback={<AppLoadingPage />}>{renderView()}</Suspense>;
}

function renderView() {
  switch (bootstrap.view) {
    case "admin":
      return <AdminDashboard data={bootstrap.data} />;
    case "teacher":
      return <TeacherDashboard data={bootstrap.data} />;
    case "api-authorization":
      return <AuthorizationPage data={bootstrap.data} />;
    case "student-session-authorization":
      return <StudentSessionAuthorizationPage data={bootstrap.data} />;
    case "student-session-connected":
      return <StudentSessionConnectedPage data={bootstrap.data} />;
    case "canvas-oauth-connected":
      return <CanvasOAuthConnectedPage data={bootstrap.data} />;
    case "seb-required":
    case "seb-download":
      return <SebDownloadPage data={bootstrap.data} />;
    case "seb-launching":
      return <SebLaunchingPage data={bootstrap.data} />;
    case "seb-launching-handoff":
      return <SebLaunchingHandoffPage data={bootstrap.data} />;
    case "seb-exit":
      return <SebExitPage data={bootstrap.data} />;
    case "seb-quit":
      return <SebQuitPage data={bootstrap.data} />;
    case "oauth-error":
      return <OAuthErrorPage data={bootstrap.data} />;
    case "student":
      return <StudentDashboard data={bootstrap.data} />;
    case "admin-setup":
      return <AdminSetupPage data={bootstrap.data} />;
    case "seb-check":
      return <SebSetupCheckPage data={bootstrap.data} />;
    case "service-status":
    default:
      return <ServiceStatusPage data={bootstrap.data} />;
  }
}

function AppLoadingPage() {
  return (
    <main className="seb-app-loading" role="status" aria-live="polite" aria-label="Loading Safe Online Exam">
      <section className="seb-app-loading__card">
        <div className="seb-app-loading__heading" />
        <div className="seb-app-loading__line" />
        <div className="seb-app-loading__row" />
        <div className="seb-app-loading__row" />
        <div className="seb-app-loading__row" />
      </section>
    </main>
  );
}
