import DashboardPage from "./pages/DashboardPage.jsx";
import SchedulePage from "./pages/SchedulePage.jsx";
import TaskManagerPage from "./pages/TaskManagerPage.jsx";
import { SiteHeader } from "../components/BoardHeader.jsx";
import "./taskManager.css";

const PAGE_BY_ROUTE = {
  dashboard: DashboardPage,
  tasks: TaskManagerPage,
  schedule: SchedulePage,
};

export default function TaskManagerRoot({ route }) {
  const Page = PAGE_BY_ROUTE[route.name] || DashboardPage;


  return (
    <div className={`site-theme tm-app min-h-screen ${route.name === "dashboard" ? "dashboard-root" : ""}`}>
      <SiteHeader active="daily" />
      <Page />
    </div>
  );
}
