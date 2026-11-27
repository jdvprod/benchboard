import { test } from "node:test";
import assert from "node:assert/strict";
import { gamesFrom, guessUs, parsePaste } from "../src/tournament/paste";

let n = 0; const id = () => "x" + n++;
const def = { bestOf: 2, scoring: "25" };

test("an AES-style pool sheet: header court, our matches, our work match, the other matches", () => {
  const p = parsePaste(`Pool 3 - Court 12
Match 1  8:00 AM  SCVC 16 Black (SC)  vs  Mavericks 16-1 (SC)  W: Coast 16 Navy (SC)
Match 2  9:00 AM  Coast 16 Navy (SC)  vs  Legacy 16 Red (SC)  W: SCVC 16 Black (SC)
Match 3  10:00 AM  Mavericks 16-1 (SC)  vs  Legacy 16 Red (SC)  W: Coast 16 Navy (SC)
Match 4  11:00 AM  Legacy 16 Red (SC)  vs  SCVC 16 Black (SC)  W: Mavericks 16-1 (SC)`);
  assert.equal(p.pool, "Pool 3"); assert.equal(p.teams.length, 4);
  const us = guessUs(p.teams, "16 Black"); assert.equal(us, "SCVC 16 Black (SC)");
  const g = gamesFrom(p, us, def, id);
  assert.deepEqual(g.games.map((x) => [x.stage, x.time, x.court, x.opp]), [
    ["pool", "08:00", "12", "Mavericks 16-1 (SC)"], ["work", "09:00", "12", "Coast 16 Navy (SC) vs Legacy 16 Red (SC)"], ["pool", "11:00", "12", "Legacy 16 Red (SC)"]]);
  assert.equal(g.others.length, 1); assert.equal(g.poolTeams.length, 3);
});

test("a coach's own shorthand", () => {
  const p = parsePaste("8am ct 4 vs Rivals\n9 work\n10:30 vs Central\n1pm Gold semifinal vs Bay Spikers ct 7");
  const g = gamesFrom(p, null, def, id);
  assert.deepEqual(g.games.map((x) => [x.stage, x.time, x.court, x.opp, x.round]), [
    ["pool", "08:00", "4", "Rivals", undefined], ["work", "09:00", "4", "", undefined], ["pool", "10:30", "4", "Central", undefined], ["bracket", "13:00", "7", "Bay Spikers", "Gold Semifinal"]]);
});

test("a copied table with columns and no 'vs'", () => {
  const p = parsePaste("8:00 AM\tCt 2\tWave 15 Blue\tTide 15\tStorm 15\n9:00 AM\tCt 2\tStorm 15\tWave 15 Blue\tTide 15");
  const g = gamesFrom(p, "Wave 15 Blue", def, id);
  assert.deepEqual(g.games.map((x) => [x.stage, x.opp]), [["pool", "Tide 15"], ["pool", "Storm 15"]]);
  assert.equal(guessUs(p.teams, "Wave Blue"), "Wave 15 Blue");
});

test("noise is skipped and team names in different case match", () => {
  const p = parsePaste("Welcome to the Fall Classic!\nCheck-in opens at 7\n\n8:00 am Court 1 storm 15 vs WAVE 15 BLUE\nParking is $10");
  const g = gamesFrom(p, "Wave 15 Blue", def, id);
  assert.equal(g.games.length, 1); assert.equal(g.games[0].opp, "storm 15");
});

test("a team named W with a dash isn't read as a work line", () => {
  const p = parsePaste("8:00 AM Team W - North vs Wave");
  assert.equal(p.lines[0].work, undefined);
});
