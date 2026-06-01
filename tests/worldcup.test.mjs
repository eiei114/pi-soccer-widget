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

test("/soccer:worldcup and /soccer:wc are registered without space-chained command registration", async () => {
  await withExtension(async ({ commands }) => {
    assert.ok(commands.has("soccer:worldcup"));
    assert.ok(commands.has("soccer:wc"));
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

test("/soccer:wc confirms PI_SOCCER_COUNTRY before persisting followed country", async () => {
  await withExtension(async ({ commands, configFile }) => {
    process.env.PI_SOCCER_COUNTRY = "Japan";
    const { ctx, confirms } = createCtx({
      confirm: () => true,
      select: () => undefined,
    });

    await commands.get("soccer:wc").handler("", ctx);

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

test("/soccer worldcup is not a World Cup command path", async () => {
  await withExtension(async ({ commands }) => {
    const soccer = commands.get("soccer");
    const { ctx, selects, confirms, notifications } = createCtx();

    assert.equal(soccer.getArgumentCompletions("world"), null);
    await soccer.handler("worldcup", ctx);

    assert.equal(selects.length, 0);
    assert.equal(confirms.length, 0);
    assert.match(notifications.at(-1)?.text ?? "", /API key is not set/);
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

