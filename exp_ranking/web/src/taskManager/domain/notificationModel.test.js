import { describe, expect, it } from "vitest";
import { buildNotificationSnapshot, isQuarterHour, normalizeNotificationSettings } from "./notificationModel.js";

describe("notification settings", () => {
  it("accepts only 15-minute times and valid timezones", () => {
    expect(isQuarterHour("20:15")).toBe(true);
    expect(isQuarterHour("20:10")).toBe(false);
    const settings = normalizeNotificationSettings({ timeZone: "Asia/Tokyo", daily: { enabled: true, time: "07:45" }, weekly: { enabled: true, weekday: 6, time: "20:10" } });
    expect(settings).toMatchObject({ timeZone: "Asia/Tokyo", daily: { enabled: true, time: "07:45" }, weekly: { enabled: true, weekday: 6, time: "20:00" } });
  });

  it("limits custom rules to ten and rejects off-grid datetimes", () => {
    const custom = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`task:${index}`, { enabled: true, scheduledAt: `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00Z` }]));
    custom.invalid = { enabled: true, scheduledAt: "2026-08-20T10:07:00Z" };
    expect(Object.keys(normalizeNotificationSettings({ custom }).custom)).toHaveLength(10);
    expect(normalizeNotificationSettings({ custom: { invalid: custom.invalid } }).custom).toEqual({});
  });

  it("syncs all incomplete visible daily and weekly tasks, while custom stays opt-in", () => {
    const settings = { custom: { selected: { enabled: true, scheduledAt: "2026-08-20T10:00:00Z" } } };
    const snapshot = buildNotificationSnapshot({
      daily: [
        { id: "daily-open", label: "Daily Open", cadence: "daily", notify: false, hidden: false, progress: { completed: false } },
        { id: "daily-done", label: "Daily Done", cadence: "daily", notify: true, hidden: false, progress: { completed: true } },
      ],
      weekly: [{ id: "weekly-open", label: "Weekly Open", cadence: "weekly", notify: false, hidden: false, progress: { completed: false } }],
      custom: [
        { id: "selected", label: "Selected", cadence: "custom", hidden: false, progress: { completed: false } },
        { id: "not-selected", label: "Not selected", cadence: "custom", hidden: false, progress: { completed: false } },
      ],
    }, settings);
    expect(snapshot.tasks.map((task) => task.id)).toEqual(["daily-open", "weekly-open", "selected"]);
  });
});
