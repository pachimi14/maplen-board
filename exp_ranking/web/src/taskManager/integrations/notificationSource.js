export const DEFAULT_NOTIFICATION_API_BASE = "https://api.lulumi-tools.com";

export function createNotificationSource(baseUrl = import.meta.env.VITE_NOTIFICATION_API_BASE || DEFAULT_NOTIFICATION_API_BASE) {
  const base = baseUrl.replace(/\/$/, "");
  async function request(path, options = {}) {
    const response = await fetch(`${base}${path}`, { credentials: "include", headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) }, ...options });
    if (!response.ok) {
      const error = new Error(`notification API ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }
  return {
    connectUrl(returnTo) { return `${base}/notifications/discord/connect?return_to=${encodeURIComponent(returnTo)}`; },
    status() { return request("/notifications/me"); },
    sync(snapshot) { return request("/notifications/state", { method: "PUT", body: JSON.stringify(snapshot) }); },
    disconnect() { return request("/notifications/connection", { method: "DELETE" }); },
  };
}
