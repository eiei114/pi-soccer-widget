import assert from "node:assert/strict";
import test from "node:test";

import { __testing } from "../dist/extensions/index.js";
import { editDistance, fuzzyScore, normalizeName, scoreTeamMatch } from "../dist/extensions/team-matching.js";

const teams = [
  { teamId: 1, name: "Arsenal FC", shortName: "Arsenal", tla: "ARS", leagueCode: "PL" },
  { teamId: 2, name: "Chelsea FC", shortName: "Chelsea", tla: "CHE", leagueCode: "PL" },
  { teamId: 3, name: "Real Madrid CF", shortName: "Real Madrid", tla: "RMA", leagueCode: "PD" },
  { teamId: 4, name: "Manchester United FC", shortName: "Man United", tla: "MUN", leagueCode: "PL" },
];

test("fuzzy score tolerates common team name misspellings", () => {
  assert.ok(scoreTeamMatch("arsnal", teams[0]) > 0);
  assert.ok(scoreTeamMatch("chelse", teams[1]) > 0);
  assert.ok(scoreTeamMatch("manchster united", teams[3]) > 0);
});

test("fuzzy score still ranks exact and prefix matches above misspell matches", () => {
  assert.ok(scoreTeamMatch("arsenal", teams[0]) > scoreTeamMatch("arsnal", teams[0]));
  assert.ok(scoreTeamMatch("real", teams[2]) > scoreTeamMatch("rel", teams[2]));
});

test("watchlist lookup rejects numeric selection and keeps fuzzy string selection working", () => {
  const config = { favoriteTeamId: 1, teams, updatedAt: new Date(0).toISOString() };

  const numeric = __testing.teamFromConfigArg("3", config);
  assert.match(numeric.message ?? "", /Numeric team IDs are no longer supported/);
  assert.equal(numeric.team, undefined);

  assert.equal(__testing.teamFromConfigArg("arsnal", config).team?.teamId, 1);
  assert.equal(__testing.teamFromConfigArg("manchster united", config).team?.teamId, 4);
});

test("watchlist lookup returns multiple candidates when top fuzzy scores tie", () => {
  const ambiguousTeams = [
    ...teams,
    { teamId: 5, name: "Newcastle United FC", shortName: "Newcastle", tla: "NEW", leagueCode: "PL" },
  ];
  const config = { favoriteTeamId: 1, teams: ambiguousTeams, updatedAt: new Date(0).toISOString() };
  const result = __testing.teamFromConfigArg("united", config);

  assert.ok(result.candidates && result.candidates.length >= 2);
  assert.equal(result.team, undefined);
  const ids = new Set(result.candidates.map((t) => t.teamId));
  assert.ok(ids.has(4));
  assert.ok(ids.has(5));
});

test("short unrelated queries do not fuzzy-match watchlist teams", () => {
  const config = { favoriteTeamId: 1, teams, updatedAt: new Date(0).toISOString() };

  assert.equal(__testing.teamFromConfigArg("xy", config).team, undefined);
  assert.equal(scoreTeamMatch("xy", teams[0]), 0);
});

test("fuzzy score handles case, empty input, and punctuation edge cases", () => {
  assert.equal(scoreTeamMatch("ARSENAL", teams[0]), scoreTeamMatch("arsenal", teams[0]));
  assert.equal(scoreTeamMatch("", teams[0]), 0);
  assert.equal(fuzzyScore("arsenal", ""), 0);
  assert.ok(scoreTeamMatch("manchester-united!!!", teams[3]) > 0);
  assert.ok(scoreTeamMatch("real_madrid", teams[2]) > 0);
});

test("fuzzy score preserves accepted edit-distance thresholds", () => {
  assert.equal(fuzzyScore("abcdefghi", "abcxyzghi"), 0);
  assert.equal(fuzzyScore("kitten", "sitting"), 0);
  assert.equal(fuzzyScore("kitten", "sitten"), 65);
  assert.equal(fuzzyScore("abcdefgh", "abxxefgh"), 58);
  assert.equal(fuzzyScore("abcdefghijklmn", "abcxxxghijklmn"), 52);
  assert.equal(fuzzyScore("internationalchampions", "internationalchompions"), 65);
});

test("fuzzy score matches full edit distance for unequal-length words", () => {
  // Each pair stays in the same query-length budget in both directions.
  const cases = [
    // Label, shorter word, longer word, full distance, expected score.
    ["one-edit limit", "ajax", "ajlax", 1, 65],
    ["one-edit limit exceeded", "ajax", "ajlix", 2, 0],
    ["two-edit limit", "arsenal", "arsxenyal", 2, 58],
    ["two-edit limit exceeded", "arsenal", "arsxenyol", 3, 0],
    ["two edits below 0.72 similarity", "bayern", "bayxrnn", 2, 0],
    ["three-edit limit", "manchesterunitedfc", "manxchestyerunitzedfc", 3, 52],
    // Four edits still clear 0.78 similarity, so distance must reject the match.
    ["three-edit limit exceeded", "manchesterunitedfc", "manxchestyerunitzedfx", 4, 0],
    ["three edits below 0.78 similarity", "manchester", "manxchyestzr", 3, 0],
  ];

  for (const [boundary, shorter, longer, distance, score] of cases) {
    for (const [direction, query, name] of [
      ["insertion", shorter, longer],
      ["deletion", longer, shorter],
    ]) {
      const label = `${boundary} (${direction}: ${query} -> ${name})`;
      assert.match(query, /^[a-z]+$/, `${label}: normalized query word`);
      assert.match(name, /^[a-z]+$/, `${label}: normalized candidate word`);
      assert.ok(!name.includes(query), `${label}: bypass exact, prefix and substring matches`);
      assert.equal(editDistance(query, name), distance, `${label}: full edit distance`);
      assert.equal(fuzzyScore(query, name), score, `${label}: score at the reference distance`);
    }
  }
});

test("team matching keeps name normalization and edit-distance behavior", () => {
  assert.equal(normalizeName("Montréal FC!"), "montreal fc");
  assert.equal(editDistance("kitten", "sitting"), 3);
});
