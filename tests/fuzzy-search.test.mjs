import assert from "node:assert/strict";
import test from "node:test";

import { __testing } from "../dist/extensions/index.js";

const teams = [
  { teamId: 1, name: "Arsenal FC", shortName: "Arsenal", tla: "ARS", leagueCode: "PL" },
  { teamId: 2, name: "Chelsea FC", shortName: "Chelsea", tla: "CHE", leagueCode: "PL" },
  { teamId: 3, name: "Real Madrid CF", shortName: "Real Madrid", tla: "RMA", leagueCode: "PD" },
  { teamId: 4, name: "Manchester United FC", shortName: "Man United", tla: "MUN", leagueCode: "PL" },
];

test("fuzzy score tolerates common team name misspellings", () => {
  assert.ok(__testing.scoreTeamMatch("arsnal", teams[0]) > 0);
  assert.ok(__testing.scoreTeamMatch("chelse", teams[1]) > 0);
  assert.ok(__testing.scoreTeamMatch("manchster united", teams[3]) > 0);
});

test("fuzzy score still ranks exact and prefix matches above misspell matches", () => {
  assert.ok(__testing.scoreTeamMatch("arsenal", teams[0]) > __testing.scoreTeamMatch("arsnal", teams[0]));
  assert.ok(__testing.scoreTeamMatch("real", teams[2]) > __testing.scoreTeamMatch("rel", teams[2]));
});

test("watchlist lookup keeps numeric selection and fuzzy string selection working", () => {
  const config = { favoriteTeamId: 1, teams, updatedAt: new Date(0).toISOString() };

  assert.equal(__testing.teamFromConfigArg("3", config).team?.teamId, 3);
  assert.equal(__testing.teamFromConfigArg("arsnal", config).team?.teamId, 1);
  assert.equal(__testing.teamFromConfigArg("manchster united", config).team?.teamId, 4);
});

test("short unrelated queries do not fuzzy-match watchlist teams", () => {
  const config = { favoriteTeamId: 1, teams, updatedAt: new Date(0).toISOString() };

  assert.equal(__testing.teamFromConfigArg("xy", config).team, undefined);
  assert.equal(__testing.scoreTeamMatch("xy", teams[0]), 0);
});

test("fuzzy score handles case, empty input, and punctuation edge cases", () => {
  assert.equal(__testing.scoreTeamMatch("ARSENAL", teams[0]), __testing.scoreTeamMatch("arsenal", teams[0]));
  assert.equal(__testing.scoreTeamMatch("", teams[0]), 0);
  assert.equal(__testing.fuzzyScore("arsenal", ""), 0);
  assert.ok(__testing.scoreTeamMatch("manchester-united!!!", teams[3]) > 0);
  assert.ok(__testing.scoreTeamMatch("real_madrid", teams[2]) > 0);
});
