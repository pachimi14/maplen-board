import { describe, expect, it } from "vitest";
import { createDefaultScheduleState, normalizeScheduleState, schedulesForDate, scheduleWeekDays, startOfScheduleWeek, upsertSchedule } from "./scheduleModel.js";

const once = {
  id: "once", title: "ボスA", category: "boss", recurrence: "once",
  date: "2026-07-20", time: "21:00", note: "", createdAt: "2026-07-01T00:00:00Z",
};
const weekly = {
  id: "weekly", title: "ボスB", category: "boss", recurrence: "weekly",
  weekday: 1, time: "20:00", note: "", createdAt: "2026-07-01T00:00:00Z",
};

describe("scheduleModel", () => {
  it("selects one-time and weekly entries by the browser-local date", () => {
    let state = createDefaultScheduleState();
    state = upsertSchedule(state, once).state;
    state = upsertSchedule(state, weekly).state;
    expect(schedulesForDate(state, new Date(2026, 6, 20, 12)).map((item) => item.id)).toEqual(["weekly", "once"]);
    expect(schedulesForDate(state, new Date(2026, 6, 21, 12))).toEqual([]);
  });

  it("sorts today's entries by time", () => {
    const state = normalizeScheduleState({ schemaVersion: 1, items: [once, weekly] });
    expect(schedulesForDate(state, new Date(2026, 6, 20)).map((item) => item.time)).toEqual(["20:00", "21:00"]);
  });

  it("builds a local Thursday-to-Wednesday calendar week", () => {
    const fromWednesday = startOfScheduleWeek(new Date(2026, 6, 22, 23, 30));
    expect([fromWednesday.getFullYear(), fromWednesday.getMonth(), fromWednesday.getDate(), fromWednesday.getDay()]).toEqual([2026, 6, 16, 4]);

    const days = scheduleWeekDays(new Date(2026, 6, 23, 12));
    expect(days.map((date) => [date.getDate(), date.getDay()])).toEqual([
      [23, 4], [24, 5], [25, 6], [26, 0], [27, 1], [28, 2], [29, 3],
    ]);
  });
  it("drops invalid dates, times, recurrence rules and duplicate ids", () => {
    const state = normalizeScheduleState({
      schemaVersion: 1,
      items: [once, { ...once, title: "duplicate" }, { ...once, id: "bad-date", date: "2026-02-30" }, { ...once, id: "bad-time", time: "25:00" }],
    });
    expect(state.items).toEqual([once]);
  });
});

