import { useEffect } from "react";
import DashboardPage from "./pages/DashboardPage.jsx";
import SchedulePage from "./pages/SchedulePage.jsx";
import TaskManagerPage from "./pages/TaskManagerPage.jsx";
import { useDashboardStore } from "./storage/useDashboardStore.js";
import "./taskManager.css";

const PAGE_BY_ROUTE = {
  dashboard: DashboardPage,
  tasks: TaskManagerPage,
  schedule: SchedulePage,
};

export default function TaskManagerRoot({ route }) {
  const dashboardStore = useDashboardStore();
  const themeColor = dashboardStore.state.themeColor || "green";
  const themeDepth = dashboardStore.state.themeDepth || "standard";
  const Page = PAGE_BY_ROUTE[route.name] || DashboardPage;

  useEffect(() => {
    document.documentElement.dataset.themeColor = themeColor;
    document.documentElement.dataset.themeDepth = themeDepth;
    return () => {
      delete document.documentElement.dataset.themeColor;
      delete document.documentElement.dataset.themeDepth;
    };
  }, [themeColor, themeDepth]);

  return (
    <div className={`tm-app min-h-screen ${route.name === "dashboard" ? "dashboard-root" : ""}`}>
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="#/" className="text-xs font-bold tracking-[0.26em] text-emerald-600">LULUMI TOOLS</a>
          <a href="#/" className="text-sm font-semibold text-slate-600 hover:text-emerald-700">EXP Ranking</a>
        </div>
      </header>
      <Page />
    </div>
  );
}
