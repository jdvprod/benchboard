import { test } from "node:test";
import assert from "node:assert/strict";
import { icsToLines, parseSchedule } from "../src/features/matchup/parseSchedule";

const ICS = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART;TZID=America/Los_Angeles:20261205T180000", "SUMMARY:vs Central", "LOCATION:Clovis North Gym\\, 2770 E International Ave", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261212", "SUMMARY:Winter Classic", "LOCATION:Fresno Convention Center", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;TZID=America/Los_Angeles:20261203T160000", "SUMMARY:Practice", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;TZID=America/Los_Angeles:20261101T160000", "SUMMARY:@ Old Game", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;TZID=America/Los_Angeles:20261208T173000", "SUMMARY:@ Buchanan (Clov", " is League)", "END:VEVENT", "END:VCALENDAR"].join("\r\n");

test("schedule: a calendar file becomes schedule lines, practices and past events left out", () => {
  const lines = icsToLines(ICS, new Date(2026, 10, 15));
  assert.deepEqual(lines, ["2026-12-05 18:00 vs Central - Clovis North Gym", "2026-12-08 17:30 @ Buchanan (Clovis League)", "2026-12-12 Winter Classic - Fresno Convention Center"]);
  const g = parseSchedule(lines.join("\n"), new Date(2026, 10, 15));
  assert.equal(g.length, 3); assert.equal(g[0].opp, "Central"); assert.equal(g[0].site, "home"); assert.equal(g[0].time, "18:00");
  assert.equal(g[1].site, "away"); assert.equal(g[1].opp, "Buchanan");
});
