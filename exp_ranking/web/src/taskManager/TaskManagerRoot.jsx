import { useEffect } from "react";
import DashboardPage from "./pages/DashboardPage.jsx";
import SchedulePage from "./pages/SchedulePage.jsx";
import TaskManagerPage from "./pages/TaskManagerPage.jsx";
import { SiteHeader } from "../components/BoardHeader.jsx";
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
      <SiteHeader active="daily" />
      <Page />
    </div>
  );
}
