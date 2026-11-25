import { describe, expect, it } from "vitest";
import { seriesPlan, translate } from "./calendarImport";
import type { GoogleEvent } from "./googleCalendar";

const TODAY = "2026-11-25"; // a wednesday

/** a moment in whatever zone the tests run in, the way google would send it */
const at = (day: string, time: string) => ({ dateTime: new Date(`${day}T${time}:00`).toISOString() });

const timed = (id: string, day: string, from: string, to: string, more: Partial<GoogleEvent> = {}): GoogleEvent => ({
  id,
  summary: id,
  start: at(day, from),
  end: at(day, to),
  ...more,
});

const allDay = (id: string, from: string, endExclusive: string, more: Partial<GoogleEvent> = {}): GoogleEvent => ({
  id,
  summary: id,
  start: { date: from },
  end: { date: endExclusive },
  ...more,
});

const rule = (text: string) => ({ recurrence: [`RRULE:${text}`] });

const only = (events: GoogleEvent[]) => {
  const { drafts } = translate(events, TODAY);
  expect(drafts).toHaveLength(1);
  return drafts[0];
};

describe("single events", () => {
  it("makes a timed event an anchor with its time and length", () => {
    const r = only([timed("dentist", "2026-11-26", "09:30", "10:15", { location: " king st " })]);
    expect(r).toMatchObject({
      kind: "anchor",
      title: "dentist",
      start: "2026-11-26",
      time: "09:30",
      duration: 45,
      place: "king st",
      done: false,
      source: "gcal:dentist",
    });
    expect(r.end).toBeUndefined();
  });

  it("makes a one-day all-day event an anchor with no time", () => {
    const r = only([allDay("holiday", "2026-12-25", "2026-12-26")]);
    expect(r).toMatchObject({ kind: "anchor", start: "2026-12-25" });
    expect(r.time).toBeUndefined();
  });

  it("makes a several-day event a floater over those days", () => {
    const r = only([allDay("trip", "2026-12-01", "2026-12-04")]);
    expect(r).toMatchObject({ kind: "floater", start: "2026-12-01", end: "2026-12-03" });
  });

  it("makes a timed event longer than a day a floater, and counts it", () => {
    const event = { ...timed("hackathon", "2026-12-05", "09:00", "09:00"), end: at("2026-12-07", "17:00") };
    const { drafts, untimed } = translate([event], TODAY);
    expect(drafts[0]).toMatchObject({ kind: "floater", start: "2026-12-05", end: "2026-12-07" });
    expect(drafts[0].time).toBeUndefined();
    expect(untimed).toBe(1);
  });

  it("keeps an event that runs past midnight on the day it starts", () => {
    const event = { ...timed("party", "2026-11-28", "22:00", "22:00"), end: at("2026-11-29", "01:00") };
    expect(only([event])).toMatchObject({ kind: "anchor", start: "2026-11-28", time: "22:00", duration: 180 });
  });

  it("names an untitled event and trims long text", () => {
    const r = only([timed("x", "2026-11-26", "09:00", "10:00", { summary: "  ", location: "l".repeat(300) })]);
    expect(r.title).toBe("busy");
    expect(r.place).toHaveLength(120);
  });

  it("leaves out what's over, cancelled, declined, or not really an event", () => {
    const { drafts } = translate(
      [
        timed("yesterday", "2026-11-24", "09:00", "10:00"),
        timed("cancelled", "2026-11-26", "09:00", "10:00", { status: "cancelled" }),
        timed("declined", "2026-11-26", "09:00", "10:00", { attendees: [{ self: true, responseStatus: "declined" }] }),
        allDay("office", "2026-11-26", "2026-11-27", { eventType: "workingLocation" }),
        timed("today", "2026-11-25", "09:00", "10:00"),
      ],
      TODAY,
    );
    expect(drafts.map((d) => d.title)).toEqual(["today"]);
  });
});

describe("series", () => {
  it.each([
    ["FREQ=DAILY", "daily"],
    ["FREQ=WEEKLY", "weekly"],
    ["FREQ=WEEKLY;BYDAY=MO", "weekly"],
    ["FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", "biweekly"],
    ["FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "weekdays"],
    ["FREQ=MONTHLY", "monthly"],
    ["FREQ=MONTHLY;BYMONTHDAY=2", "monthly"],
    ["FREQ=YEARLY", "yearly"],
  ])("reads %s as %s", (text, repeat) => {
    // 2026-11-02 is a monday
    const r = only([timed("class", "2026-11-02", "10:00", "10:50", rule(text))]);
    expect(r).toMatchObject({ repeat, start: "2026-11-02", time: "10:00", duration: 50 });
    expect(r.repeatUntil).toBeUndefined();
  });

  it.each([
    "FREQ=WEEKLY;INTERVAL=3",
    "FREQ=MONTHLY;BYDAY=2TU",
    "FREQ=MONTHLY;BYMONTHDAY=15",
    "FREQ=DAILY;INTERVAL=2",
    "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE",
    "FREQ=YEARLY;BYMONTH=3",
    "FREQ=MONTHLY;BYSETPOS=-1;BYDAY=FR",
  ])("has no plan for %s", (text) => {
    expect(seriesPlan(timed("class", "2026-11-02", "10:00", "10:50", rule(text)))).toBeNull();
  });

  it("has no plan for a rule with extra or excluded dates", () => {
    const event = timed("class", "2026-11-02", "10:00", "10:50", {
      recurrence: ["RRULE:FREQ=WEEKLY", "EXDATE:20261109T100000Z"],
    });
    expect(seriesPlan(event)).toBeNull();
    expect(translate([event], TODAY).drafts).toEqual([]);
  });

  it("splits a several-weekday series into one weekly reminder per day", () => {
    const { drafts } = translate([timed("lecture", "2026-11-02", "10:00", "10:50", rule("FREQ=WEEKLY;BYDAY=MO,WE,FR"))], TODAY);
    expect(drafts.map((d) => [d.start, d.repeat, d.source])).toEqual([
      ["2026-11-02", "weekly", "gcal:lecture:MO"],
      ["2026-11-04", "weekly", "gcal:lecture:WE"],
      ["2026-11-06", "weekly", "gcal:lecture:FR"],
    ]);
    expect(new Set(drafts.map((d) => d.id)).size).toBe(3);
  });

  it("turns an end date into repeatUntil", () => {
    const r = only([allDay("term", "2026-11-02", "2026-11-03", rule("FREQ=WEEKLY;UNTIL=20261214"))]);
    expect(r.repeatUntil).toBe("2026-12-14");
  });

  it("turns a count into the day of the last occurrence", () => {
    const weekly = only([timed("course", "2026-11-02", "10:00", "11:00", rule("FREQ=WEEKLY;COUNT=6"))]);
    expect(weekly.repeatUntil).toBe("2026-12-07");

    // five weeks of mon + wed is ten; the eleventh is the sixth monday
    const { drafts } = translate([timed("lab", "2026-11-02", "10:00", "11:00", rule("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=11"))], TODAY);
    expect(drafts.map((d) => d.repeatUntil)).toEqual(["2026-12-07", "2026-12-07"]);
  });

  it("leaves out a series that has already ended", () => {
    const event = timed("old", "2026-09-07", "10:00", "11:00", rule("FREQ=WEEKLY;UNTIL=20261101"));
    expect(translate([event], TODAY).drafts).toEqual([]);
  });

  it("can't repeat a several-day event daily", () => {
    expect(seriesPlan(allDay("camp", "2026-12-01", "2026-12-04", rule("FREQ=DAILY")))).toBeNull();
    expect(seriesPlan(allDay("camp", "2026-12-01", "2026-12-04", rule("FREQ=MONTHLY")))).toMatchObject({ repeat: "monthly" });
  });
});

describe("changed occurrences", () => {
  const lecture = timed("lecture", "2026-11-02", "10:00", "10:50", rule("FREQ=WEEKLY;BYDAY=MO,WE"));
  const occurrence = (day: string) => ({ recurringEventId: "lecture", originalStartTime: at(day, "10:00") });

  it("ticks off a cancelled occurrence on the reminder it belongs to", () => {
    const { drafts } = translate([lecture, { id: "lecture_c", status: "cancelled", ...occurrence("2026-12-02") }], TODAY);
    expect(drafts.map((d) => d.doneDates)).toEqual([[], ["2026-12-02"]]);
  });

  it("moves an occurrence: ticked off where it was, a one-off where it went", () => {
    const moved = timed("lecture_m", "2026-12-01", "14:00", "14:50", { summary: "lecture", ...occurrence("2026-11-30") });
    const { drafts } = translate([lecture, moved], TODAY);
    expect(drafts.map((d) => [d.start, d.repeat ?? null, d.doneDates ?? null])).toEqual([
      ["2026-11-02", "weekly", ["2026-11-30"]],
      ["2026-11-04", "weekly", []],
      ["2026-12-01", null, null],
    ]);
  });

  it("treats an occurrence whose series isn't here as an event of its own", () => {
    const r = only([timed("standup_1", "2026-11-26", "09:00", "09:15", { recurringEventId: "standup" })]);
    expect(r).toMatchObject({ start: "2026-11-26", source: "gcal:standup_1" });
    expect(r.repeat).toBeUndefined();
  });
});
