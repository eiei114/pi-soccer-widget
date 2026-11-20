import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

let testRun = 0;

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function withExtension(fn) {
  const tmpHome = mkdtempSync(join(tmpdir(), "pi-soccer-widget-wc-"));
  const previousEnv = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    FOOTBALL_DATA_API_TOKEN: process.env.FOOTBALL_DATA_API_TOKEN,
    PI_SOCCER_COUNTRY: process.env.PI_SOCCER_COUNTRY,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    LC_MESSAGES: process.env.LC_MESSAGES,
    TZ: process.env.TZ,
  };

  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete process.env.FOOTBALL_DATA_API_TOKEN;
  delete process.env.PI_SOCCER_COUNTRY;
  process.env.LANG = "C";
  process.env.LC_ALL = "C";
  delete process.env.LC_MESSAGES;
  process.env.TZ = "Etc/UTC";

  const agentDir = join(tmpHome, ".pi", "agent");
  const configFile = join(agentDir, "pi-soccer-widget-config.json");

  try {
    const extensionUrl = pathToFileURL(join(process.cwd(), "dist", "extensions", "index.js"));
    extensionUrl.searchParams.set("worldCupRun", String(testRun++));
    const mod = await import(extensionUrl.href);
    const { default: soccerWidgetExtension, __testing } = mod;
    const commands = new Map();
    soccerWidgetExtension({
      on() {},
      registerCommand(name, definition) {
        commands.set(name, definition);
      },
    });
    await fn({ commands, agentDir, configFile, testing: __testing });
  } finally {
    rmSync(tmpHome, { recursive: true, force: true });
    for (const [name, value] of Object.entries(previousEnv)) restoreEnv(name, value);
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf-8"));
}

function createCtx(overrides = {}) {
  const notifications = [];
  const selects = [];
  const confirms = [];
  const inputs = [];
  return {
    notifications,
    selects,
    confirms,
    inputs,
    ctx: {
      hasUI: true,
      ui: {
        theme: { fg: (_color, text) => text },
        notify: (text, level = "info") => notifications.push({ text, level }),
        setWidget() {},
        input: async (title, placeholder) => {
          inputs.push({ title, placeholder });
          return overrides.input?.(title, placeholder);
        },
        confirm: async (title, detail) => {
          confirms.push({ title, detail });
          return overrides.confirm?.(title, detail) ?? false;
        },
        select: async (title, items) => {
          selects.push({ title, items });
          return overrides.select?.(title, items);
        },
      },
    },
  };
}

const WORLD_CUP_FIXTURE_TOKEN = "fd_test_inert_worldcup_menu_token";
const WORLD_CUP_MENU_TEST_NOW = "2026-06-11T23:59:59.999Z";
const JAPAN = { teamId: 900017, name: "Japan", shortName: "Japan", tla: "JPN", leagueCode: "WC" };

function worldCupCommandConfig() {
  return {
    favoriteTeamId: null,
    teams: [],
    worldCup: {
      followedTeamId: JAPAN.teamId,
      teams: [JAPAN],
      countryCode: JAPAN.tla,
      updatedAt: "2026-05-01T00:00:00Z",
    },
    updatedAt: "2026-05-01T00:00:00Z",
  };
}

function worldCupMatch({ id = 406, opponent = "Mexico", group = "Group C", scorer = "Hina" } = {}) {
  const opponentId = opponent === "Mexico" ? 900020 : opponent === "Canada" ? 900005 : 900033;
  const today = new Date().toISOString().slice(0, 10);
  return {
    id,
    utcDate: `${today}T18:00:00Z`,
    status: "SCHEDULED",
    stage: "GROUP_STAGE",
    group,
    matchday: 1,
    homeTeam: { id: JAPAN.teamId, name: JAPAN.name, shortName: JAPAN.shortName, tla: JAPAN.tla },
    awayTeam: { id: opponentId, name: opponent, shortName: opponent, tla: opponent === "Mexico" ? "MEX" : "CAN" },
    score: { winner: null, fullTime: { home: null, away: null }, penalties: null },
    goals: [{ minute: 12, team: { id: JAPAN.teamId, name: JAPAN.name }, scorer: { name: scorer } }],
    bookings: [],
  };
}

async function withWorldCupApiFixtures(fn, { allowMatchDetailNotFound = false } = {}) {
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.FOOTBALL_DATA_API_TOKEN;
  const requests = [];
  const violations = [];
  const fixturePaths = new Set([
    "/v4/competitions/WC/teams",
    "/v4/competitions/WC/matches",
    "/v4/competitions/WC/standings",
    "/v4/competitions/WC/scorers",
    "/v4/matches/406",
  ]);
  process.env.FOOTBALL_DATA_API_TOKEN = WORLD_CUP_FIXTURE_TOKEN;
  globalThis.fetch = async (input, init = {}) => {
    let url;
    try {
      url = new URL(String(input));
    } catch (error) {
      violations.push(`Invalid football-data request URL: ${String(input)} (${error.message})`);
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }

    let token;
    try {
      const requestHeaders = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
      token = requestHeaders.get("X-Auth-Token");
    } catch (error) {
      violations.push(`Invalid request headers for ${url.href}: ${error.message}`);
    }

    const request = { url, token, status: 200 };
    requests.push(request);
    if (url.origin !== "https://api.football-data.org") {
      violations.push(`Unexpected request origin ${url.origin}: ${url.href}`);
    }
    if (token !== WORLD_CUP_FIXTURE_TOKEN) {
      violations.push(`Request did not use the inert fixture token: ${url.href}`);
    }
    if (!fixturePaths.has(url.pathname)) {
      violations.push(`Unexpected football-data endpoint: ${url.href}`);
    }

    let body;
    if (url.pathname === "/v4/competitions/WC/teams") {
      body = { teams: [{ id: JAPAN.teamId, name: JAPAN.name, shortName: JAPAN.shortName, tla: JAPAN.tla }] };
    } else if (url.pathname === "/v4/competitions/WC/matches") {
      body = { matches: [worldCupMatch()] };
    } else if (url.pathname === "/v4/competitions/WC/standings") {
      body = {
        standings: [{
          type: "TOTAL",
          group: "Group C",
          table: [{ position: 1, points: 3, playedGames: 1, team: { id: JAPAN.teamId, name: JAPAN.name, shortName: JAPAN.shortName, tla: JAPAN.tla } }],
        }],
      };
    } else if (url.pathname === "/v4/competitions/WC/scorers") {
      body = { scorers: [{ player: { name: "Taro Striker" }, team: { id: JAPAN.teamId, name: JAPAN.name, shortName: JAPAN.shortName }, goals: 3 }] };
    } else if (url.pathname === "/v4/matches/406") {
      if (!allowMatchDetailNotFound) {
        violations.push("The match-detail 404 fixture is only allowed for the Match detail menu choice");
      }
      request.status = 404;
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    } else {
      request.status = 404;
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }

    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    await fn(requests);
    assert.deepEqual(violations, [], "World Cup API fixture violations must fail after handlers finish");
    assert.ok(requests.length > 0, "menu handlers must issue mocked football-data requests");
    for (const request of requests) {
      assert.equal(request.url.origin, "https://api.football-data.org", "tests must not fetch any live or unrelated host");
      assert.equal(request.token, WORLD_CUP_FIXTURE_TOKEN, "requests use only the inert fixture token");
      assert.ok(fixturePaths.has(request.url.pathname), `Unexpected football-data endpoint: ${request.url.href}`);
    }
    assert.deepEqual(
      requests.filter((request) => request.status === 404).map((request) => request.url.pathname),
      allowMatchDetailNotFound ? ["/v4/matches/406"] : [],
      "only the selected Match detail fixture may return the expected 404",
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("FOOTBALL_DATA_API_TOKEN", previousToken);
  }
}

async function runWorldCupMenuChoice({ commands, configFile, agentDir, choice, cachedMatch } = {}) {
  writeJson(configFile, worldCupCommandConfig());
  if (cachedMatch) {
    const now = Date.now();
    writeJson(join(agentDir, "pi-soccer-widget-snapshots.json"), {
      timestamp: now,
      discoveryTeamIds: [],
      snapshots: {},
      worldCup: {
        timestamp: now,
        fetchedAt: now,
        team: JAPAN,
        teams: [JAPAN],
        matches: [cachedMatch],
        standings: [],
        topScorers: null,
        topScorersAvailable: false,
      },
    });
  }

  let result;
  await withWorldCupApiFixtures(async (requests) => {
    const { ctx, notifications } = createCtx({ select: (_title, items) => items.find((item) => item === choice) });
    await commands.get("soccer:worldcup").handler("", ctx);
    result = { notifications, requests };
  }, { allowMatchDetailNotFound: choice === "Match detail" });
  return result;
}

test("World Cup API fixture guard catches swallowed host, token and endpoint violations", async () => {
  await assert.rejects(
    withWorldCupApiFixtures(async () => {
      await Promise.allSettled([
        fetch("https://unexpected.example/v4/unexpected", {
          headers: { "X-Auth-Token": "not-the-inert-fixture-token" },
        }),
      ]);
    }),
    /World Cup API fixture violations must fail after handlers finish/,
  );
});

test("/soccer:worldcup is registered without legacy aliases or space-chained commands", async () => {
  await withExtension(async ({ commands }) => {
    assert.ok(commands.has("soccer:worldcup"));
    assert.equal(commands.has("soccer:wc"), false);
    assert.equal(commands.has("soccer"), false);
    assert.equal(commands.has("soccer worldcup"), false);
    assert.equal(commands.has("soccer wc"), false);
  });
});

test("saved World Cup config opens the expected menu", async () => {
  await withExtension(async ({ commands, configFile }) => {
    writeJson(configFile, {
      favoriteTeamId: null,
      teams: [],
      worldCup: {
        followedTeamId: 900017,
        teams: [{ teamId: 900017, name: "Japan", shortName: "Japan", tla: "JPN", leagueCode: "WC" }],
        countryCode: "JPN",
        updatedAt: "2026-05-01T00:00:00Z",
      },
      updatedAt: "2026-05-01T00:00:00Z",
    });
    const { ctx, selects, confirms, inputs } = createCtx({ select: () => undefined });

    await commands.get("soccer:worldcup").handler("", ctx);

    assert.equal(confirms.length, 0, "saved country should not need confirmation");
    assert.equal(inputs.length, 0, "saved country should skip manual search");
    assert.deepEqual(selects[0].items, [
      "Follow my country",
      "Today's matches",
      "Group table",
      "Match detail",
      "Top scorers",
      "Settings",
    ]);
    assert.match(selects[0].title, /World Cup \| Japan/);
  });
});

test("World Cup Today's matches menu dispatch renders fixtures with an info notification", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(WORLD_CUP_MENU_TEST_NOW) });
  try {
    await withExtension(async ({ commands, configFile, agentDir }) => {
      assert.equal(new Date().toISOString(), WORLD_CUP_MENU_TEST_NOW, "fixture and handler must share the fixed test clock");
      const { notifications, requests } = await runWorldCupMenuChoice({ commands, configFile, agentDir, choice: "Today's matches" });

      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].level, "info");
      assert.match(notifications[0].text, /World Cup today:/);
      assert.match(notifications[0].text, /Japan vs Mexico/);
      assert.ok(requests.some(({ url }) => url.pathname === "/v4/competitions/WC/matches"));
    });
  } finally {
    t.mock.timers.reset();
  }
});

test("World Cup Group table menu dispatch renders the followed country's group with an info notification", async () => {
  await withExtension(async ({ commands, configFile, agentDir }) => {
    const { notifications } = await runWorldCupMenuChoice({ commands, configFile, agentDir, choice: "Group table" });

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].level, "info");
    assert.match(notifications[0].text, /World Cup Group C:/);
    assert.match(notifications[0].text, /1\. Japan 3pts \(1 played\)/);
  });
});

test("World Cup Top scorers menu dispatch renders fixture scorers with an info notification", async () => {
  await withExtension(async ({ commands, configFile, agentDir }) => {
    const { notifications } = await runWorldCupMenuChoice({ commands, configFile, agentDir, choice: "Top scorers" });

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].level, "info");
    assert.match(notifications[0].text, /World Cup top scorers:/);
    assert.match(notifications[0].text, /1\. Taro Striker \(Japan\) - 3/);
  });
});

test("World Cup Match detail forces a refresh and falls back to its refreshed snapshot match", async () => {
  await withExtension(async ({ commands, configFile, agentDir }) => {
    const cachedMatch = worldCupMatch({ id: 405, opponent: "Canada", group: "Group B", scorer: "Old scorer" });
    const { notifications, requests } = await runWorldCupMenuChoice({
      commands,
      configFile,
      agentDir,
      choice: "Match detail",
      cachedMatch,
    });

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].level, "info");
    assert.match(notifications[0].text, /World Cup match detail:/);
    assert.match(notifications[0].text, /Japan vs Mexico/);
    assert.match(notifications[0].text, /Goals: Hina 12'/);
    assert.doesNotMatch(notifications[0].text, /Canada|Old scorer/);
    assert.ok(requests.some(({ url }) => url.pathname === "/v4/competitions/WC/matches"), "a fresh snapshot must be fetched despite the warm cache");
    assert.ok(requests.some(({ url, status }) => url.pathname === "/v4/matches/406" && status === 404), "the refreshed match's detail endpoint must return the expected not-found fixture");
  });
});

test("/soccer:worldcup confirms PI_SOCCER_COUNTRY before persisting followed country", async () => {
  await withExtension(async ({ commands, configFile }) => {
    process.env.PI_SOCCER_COUNTRY = "Japan";
    const { ctx, confirms } = createCtx({
      confirm: () => true,
      select: () => undefined,
    });

    await commands.get("soccer:worldcup").handler("", ctx);

    assert.equal(confirms.length, 1);
    assert.match(confirms[0].detail, /PI_SOCCER_COUNTRY/);
    const config = readJson(configFile);
    assert.equal(config.worldCup.countryCode, "JPN");
    assert.equal(config.worldCup.followedTeamId, 900017);
    assert.equal(config.worldCup.teams[0].leagueCode, "WC");
  });
});

test("declined guessed country falls back to manual country search", async () => {
  await withExtension(async ({ commands, configFile }) => {
    process.env.PI_SOCCER_COUNTRY = "Japan";
    const { ctx, confirms, inputs } = createCtx({
      confirm: () => false,
      input: () => "Canada",
      select: (title, items) => title.includes("Choose World Cup country") ? items.find((item) => item.includes("Canada")) : undefined,
    });

    await commands.get("soccer:worldcup").handler("", ctx);

    assert.equal(confirms.length, 1, "PI_SOCCER_COUNTRY guess must be explicitly confirmable");
    assert.equal(inputs.length, 1, "declined guess should ask for manual search");
    const config = readJson(configFile);
    assert.equal(config.worldCup.countryCode, "CAN");
    assert.equal(config.worldCup.teams[0].name, "Canada");
  });
});

test("legacy /soccer command is not registered", async () => {
  await withExtension(async ({ commands }) => {
    assert.equal(commands.has("soccer"), false);
  });
});

test("World Cup widget uses the group containing the followed country and keeps event strip compact", async () => {
  await withExtension(async ({ testing }) => {
    const team = { teamId: 900017, name: "Japan", shortName: "Japan", tla: "JPN", leagueCode: "WC" };
    const snapshot = {
      timestamp: Date.now(),
      fetchedAt: Date.now(),
      team,
      teams: [team],
      matches: [{
        id: 1,
        utcDate: new Date().toISOString(),
        status: "IN_PLAY",
        group: "Group B",
        homeTeam: { id: 900017, name: "Japan", shortName: "Japan", tla: "JPN" },
        awayTeam: { id: 2, name: "Germany", shortName: "Germany", tla: "GER" },
        score: { winner: null, fullTime: { home: 2, away: 2 }, penalties: { home: 4, away: 3 } },
        goals: [
          { minute: 12, team: { id: 900017, name: "Japan" }, scorer: { name: "Aoki" } },
          { minute: 44, team: { id: 2, name: "Germany" }, scorer: { name: "Muller" } },
        ],
        bookings: [{ minute: 80, team: { id: 2, name: "Germany" }, player: { name: "Schmidt" }, card: "RED_CARD" }],
      }],
      standings: [
        { type: "TOTAL", group: "Group A", table: [{ position: 1, points: 6, playedGames: 2, team: { id: 3, name: "Canada" } }] },
        { type: "TOTAL", group: "Group B", table: [{ position: 2, points: 4, playedGames: 2, team: { id: 900017, name: "Japan", tla: "JPN" } }] },
      ],
      topScorers: null,
      topScorersAvailable: false,
    };

    const lines = testing.renderWorldCupSnapshot(snapshot, { fg: (_color, text) => text });
    const text = lines.join("\n");

    assert.match(text, /Group B #2/);
    assert.doesNotMatch(text, /Group A/);
    assert.match(text, /Goals: Aoki 12', Germany: Muller 44'/);
    assert.match(text, /Notes: 1 red card \| pens 4-3/);
    assert.match(text, /sync ~10m/);
  });
});

test("World Cup top scorers view degrades to not available", async () => {
  await withExtension(async ({ testing }) => {
    const text = testing.formatWorldCupTopScorers({ topScorers: null, topScorersAvailable: false });
    assert.equal(text, "World Cup top scorers: not available.");
  });
});

test("World Cup default widget mode does not change existing club widget unless forced", async () => {
  await withExtension(async ({ testing }) => {
    const club = { teamId: 86, name: "Real Madrid", shortName: "Real Madrid", tla: "RMA", leagueCode: "PD" };
    const japan = { teamId: 900017, name: "Japan", shortName: "Japan", tla: "JPN", leagueCode: "WC" };
    const worldCup = { followedTeamId: 900017, teams: [japan], countryCode: "JPN", updatedAt: "2026-05-01T00:00:00Z" };

    assert.equal(testing.shouldUseWorldCupWidget({ favoriteTeamId: 86, teams: [club], worldCup, updatedAt: "2026-05-01T00:00:00Z" }), false);
    assert.equal(testing.shouldUseWorldCupWidget({ favoriteTeamId: null, teams: [], worldCup, updatedAt: "2026-05-01T00:00:00Z" }), true);
    assert.equal(testing.shouldUseWorldCupWidget({ favoriteTeamId: 86, teams: [club], worldCup: { ...worldCup, widgetMode: "worldcup" }, updatedAt: "2026-05-01T00:00:00Z" }), true);
  });
});

test("World Cup widget mode change resets refresh timer cadence immediately", async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const delays = [];
  let cleared = 0;
  globalThis.setInterval = (_fn, delay) => {
    delays.push(delay);
    return { unref() {} };
  };
  globalThis.clearInterval = () => {
    cleared += 1;
  };

  try {
    await withExtension(async ({ commands, configFile }) => {
      writeJson(configFile, {
        favoriteTeamId: 86,
        teams: [{ teamId: 86, name: "Real Madrid", shortName: "Real Madrid", tla: "RMA", leagueCode: "PD" }],
        worldCup: {
          followedTeamId: 900017,
          teams: [{ teamId: 900017, name: "Japan", shortName: "Japan", tla: "JPN", leagueCode: "WC" }],
          countryCode: "JPN",
          widgetMode: "club",
          updatedAt: "2026-05-01T00:00:00Z",
        },
        updatedAt: "2026-05-01T00:00:00Z",
      });
      const { ctx } = createCtx({
        select: (title, items) => title.startsWith("World Cup settings") ? "Use World Cup widget" : items.find((item) => item === "Settings"),
      });

      await commands.get("soccer:worldcup").handler("", ctx);
    });
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }

  assert.equal(delays.at(-1), 10 * 60 * 1000);
  assert.equal(cleared, 0);
});

