import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, clubEvents, clubIcs, clubLeaders, ClubTeam, homeClashes } from "../src/features/club/club";

const teams: ClubTeam[] = [
  { id: "a", name: "Clovis 16", level: "Black", schedule: [
    { id: "s1", date: "2026-12-05", time: "10:00", opp: "Central", site: "home", event: "League" },
    { id: "s2", date: "2026-12-06", time: "", opp: "Buchanan", site: "away", event: "" },
    { id: "old", date: "2026-11-01", time: "10:00", opp: "Past", site: "home", event: "" }] },
  { id: "b", name: "Clovis 15", schedule: [
    { id: "s3", date: "2026-12-05", time: "11:00", opp: "Fresno", site: "home", event: "" },
    { id: "s4", date: "2026-12-05", time: "15:00", opp: "Clovis West", site: "home", event: "" }],
    tournaments: [{ id: "tn", name: "Winter Classic", start: "2026-12-12", end: "2026-12-13", site: "Fresno Convention Center", poolTeams: [], games: [], others: [], createdAt: 0 }],
    practices: [{ id: "p1", date: "2026-12-07", start: "18:00", title: "Practice" }] },
  { id: "c", name: "Clovis 14", practices: [{ id: "p2", date: "2026-12-07", start: "18:30", title: "Practice" }] },
];

test("club: one calendar for every team, in order, from today", () => {
  const ev = clubEvents(teams, "2026-12-01");
  assert.deepEqual(ev.map((e) => e.id), ["m:a:s1", "m:b:s3", "m:b:s4", "m:a:s2", "p:b:p1", "p:c:p2", "t:b:tn"]);
  assert.equal(ev[0].team, "Clovis 16 Black"); assert.equal(ev[0].title, "vs Central"); assert.equal(ev[3].title, "at Buchanan");
  assert.equal(ev[6].end, "2026-12-13");
  assert.equal(clubEvents(teams, "2026-12-01", 3).length, 0, "the window limits it");
});

test("club: home events that need the gym at the same time are flagged", () => {
  const c = homeClashes(clubEvents(teams, "2026-12-01"));
  assert.equal(c.length, 2);
  assert.deepEqual(c[0].teams, ["Clovis 16 Black", "Clovis 15"]); assert.equal(c[0].date, "2026-12-05");
  assert.equal(c[1].date, "2026-12-07", "practices count as home");
  assert.ok(!c.some((x) => x.ids.includes("m:b:s4")), "four hours apart is fine");
  assert.ok(!c.some((x) => x.ids.includes("m:a:s2")), "away matches don't need the gym");
});

test("club: one calendar file for the club", () => {
  const ics = clubIcs(clubEvents(teams, "2026-12-01"), "Clovis Volleyball Club");
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 7);
  assert.match(ics, /SUMMARY:Clovis 16 Black: vs Central/); assert.match(ics, /DTSTART:20261205T100000/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261212\r\nDTEND;VALUE=DATE:20261214/, "a two-day tournament spans both days");
  assert.match(ics, /LOCATION:Fresno Convention Center/); assert.match(ics, /X-WR-CALNAME:Clovis Volleyball Club/);
});

test("club: leaders need enough sets and a real number", () => {
  const rows = [{ id: "1", name: "Ava", num: "1", team: "A", v: 3.1, sets: 20 }, { id: "2", name: "Bo", num: "2", team: "B", v: 4.5, sets: 3 }, { id: "3", name: "Cy", num: "3", team: "B", v: 2.2, sets: 12 }, { id: "4", name: "Di", num: "4", team: "C", v: 0, sets: 30 }];
  assert.deepEqual(clubLeaders(rows).map((r) => r.name), ["Ava", "Cy"]);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

import { clubToday } from "../src/features/club/club";
test("club today: each team's next games and work, soonest first, finished games left out", () => {
  const today = "2026-12-05";
  const teams: any[] = [
    { id: "a", name: "16 Black", tournaments: [{ id: "t1", name: "Fall Classic", site: "Fresno", start: today, poolTeams: [], others: [], createdAt: 0, games: [
      { id: "g1", stage: "pool", opp: "Rivals", time: "08:00", court: "4", bestOf: 2, scoring: "25", matchId: "m1" },
      { id: "g2", stage: "work", opp: "X vs Y", time: "09:00", court: "4", bestOf: 2, scoring: "25" },
      { id: "g3", stage: "pool", opp: "Central", time: "10:00", court: "4", bestOf: 2, scoring: "25" }] }] },
    { id: "b", name: "14 Blue", schedule: [{ id: "s1", date: today, time: "07:30", opp: "Tide", site: "home" }] },
    { id: "c", name: "12 White", schedule: [{ id: "s2", date: "2026-12-06", time: "09:00", opp: "Wave" }] },
  ];
  const rows = clubToday(teams, today, (id) => id === "m1");
  assert.deepEqual(rows.map((r) => r.team), ["14 Blue", "16 Black"]);
  assert.deepEqual(rows[1].next.map((x) => x.label), ["Work: X vs Y", "vs Central"]);
  assert.equal(rows[1].left, 2); assert.equal(rows[1].where, "Fall Classic, Fresno"); assert.equal(rows[1].next[0].work, true);
});
