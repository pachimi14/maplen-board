import { useEffect, useState } from "react";
import { createNotificationSource } from "../integrations/notificationSource.js";

const source = createNotificationSource();

export default function NotificationBackgroundSync({ snapshot }) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let active = true;
    source.status()
      .then(() => { if (active) setConnected(true); })
      .catch(() => { if (active) setConnected(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!connected) return undefined;
    const timer = window.setTimeout(() => {
      source.sync(snapshot).catch(() => {});
    }, 700);
    return () => window.clearTimeout(timer);
  }, [connected, snapshot]);

  return null;
}
