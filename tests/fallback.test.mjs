import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach, beforeEach } from "node:test";
import { pathToFileURL } from "node:url";

const originalFetch = globalThis.fetch;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalToken = process.env.FOOTBALL_DATA_API_TOKEN;
const originalLeagues = process.env.PI_SOCCER_LEAGUES;
const registrySymbol = Symbol.for("pi-widget-host.registry.v1");
const presenceSymbol = Symbol.for("pi-widget-host.presence.v1");

let testRun = 0;
let testHome;
let agentDir;
let configFile;
let snapshotsFile;
let registered;

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

beforeEach(async () => {
  resetHostGlobals();
  testHome = mkdtempSync(join(tmpdir(), "pi-soccer-widget-"));
  process.env.HOME = testHome;
  process.env.USERPROFILE = testHome;
  process.env.FOOTBALL_DATA_API_TOKEN = "test-token";
  process.env.PI_SOCCER_LEAGUES = "SA";

  agentDir = join(testHome, ".pi", "agent");
  configFile = join(agentDir, "pi-soccer-widget-config.json");
  snapshotsFile = join(agentDir, "pi-soccer-widget-snapshots.json");
  registered = { events: {}, commands: {} };

  const extensionUrl = pathToFileURL(join(process.cwd(), "dist", "extensions", "index.js"));
  extensionUrl.searchParams.set("testRun", String(testRun++));
  const { default: soccerWidgetExtension } = await import(extensionUrl.href);
  soccerWidgetExtension({
    on(name, handler) {
      registered.events[name] = handler;
    },
    registerCommand(name, command) {
      registered.commands[name] = command;
    },
  });
});

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true });
  resetHostGlobals();
  globalThis.fetch = originalFetch;
  restoreEnv("HOME", originalHome);
  restoreEnv("USERPROFILE", originalUserProfile);
  restoreEnv("FOOTBALL_DATA_API_TOKEN", originalToken);
  restoreEnv("PI_SOCCER_LEAGUES", originalLeagues);
});

const theme = {
  fg: (_color, text) => text,
};

function resetHostGlobals() {
  delete globalThis[registrySymbol];
  delete globalThis[presenceSymbol];
}

function activateWidgetHost() {
  const entries = new Map();
  const registryListeners = new Set();
  const presence = { active: true, listeners: new Set() };
  globalThis[presenceSymbol] = presence;
  globalThis[registrySymbol] = {
    version: 1,
    set(entry) {
      entries.set(entry.providerId, { ...entry, lines: [...entry.lines], tags: entry.tags ? [...entry.tags] : undefined });
      for (const listener of registryListeners) listener();
    },
    remove(providerId) {
      entries.delete(providerId);
      for (const listener of registryListeners) listener();
    },
    list() {
      return [...entries.values()];
    },
    subscribe(listener) {
      registryListeners.add(listener);
      return () => registryListeners.delete(listener);
    },
    clear() {
      entries.clear();
      for (const listener of registryListeners) listener();
    },
  };
  return {
    entries,
    setPresence(active) {
      presence.active = active;
      for (const listener of presence.listeners) listener(active);
    },
  };
}

function writeJson(file, value) {
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf-8"));
}

function team(id, name, leagueCode = "PL") {
  return {
    teamId: id,
    name,
    shortName: name,
    tla: name.slice(0, 3).toUpperCase(),
    leagueCode,
  };
}

function snapshot(record, fetchedAt = Date.now() - 2 * 60 * 60 * 1000) {
  return {
    team: record,
    standing: { position: 1, points: 42, playedGames: 18 },
    lastResult: {
      utcDate: "2026-05-20T18:00:00Z",
      homeShort: record.shortName,
      awayShort: "Rivals",
      homeScore: 2,
      awayScore: 1,
      wdl: "W",
    },
    nextMatch: { utcDate: "2026-05-30T18:00:00Z", opponentShort: "Next" },
    fetchedAt,
    source: "watchlist",
  };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function seedConfig(record, extraTeams = []) {
  writeJson(configFile, {
    favoriteTeamId: record.teamId,
    teams: [record, ...extraTeams],
    updatedAt: "2026-05-01T00:00:00Z",
  });
}

function seedStaleCache(record) {
  seedConfig(record);
  writeJson(snapshotsFile, {
    timestamp: Date.now() - 7 * 60 * 60 * 1000,
    discoveryTeamIds: [],
    snapshots: { [String(record.teamId)]: snapshot(record) },
  });
}

test("publishes Soccer lines through Widget Host provider presence and restores standalone display", async () => {
  const host = activateWidgetHost();
  const arsenal = team(57, "Arsenal");
  seedStaleCache(arsenal);
  const cache = readJson(snapshotsFile);
  cache.snapshots[String(arsenal.teamId)].nextMatch.utcDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  writeJson(snapshotsFile, cache);
  globalThis.fetch = async () => response(500, { message: "server error" });

  const { widgets } = await startSession();
  const entry = host.entries.get("pi-soccer-widget");

  assert.equal(widgets.at(-1)?.id, "pi-soccer-widget");
  assert.equal(widgets.at(-1)?.lines, undefined);
  assert.ok(entry, "provider entry should be published while host owns display");
  assert.match(entry.lines.join("\n"), /Soccer: Arsenal \| PL/);
  assert.deepEqual(entry.tags, ["sports", "matchday"]);
  assert.equal(entry.priority, 70);
  assert.equal(entry.ttlMs, 6 * 60 * 60 * 1000);
  assert.ok(!Number.isNaN(Date.parse(entry.updatedAt)), "provider entry should include a valid updatedAt for host expiry");
  assert.equal(entry.mode, "club");

  host.setPresence(false);
  assert.equal(host.entries.has("pi-soccer-widget"), false);
  assert.match((widgets.at(-1)?.lines ?? []).join("\n"), /Soccer: Arsenal \| PL/);
});

test("session start skips async display controller if shutdown wins the race", async () => {
  seedStaleCache(team(57, "Arsenal"));
  globalThis.fetch = async () => response(500, { message: "server error" });
  const widgets = [];
  const ctx = {
    hasUI: true,
    ui: {
      theme,
      setWidget(id, lines) {
        widgets.push({ id, lines });
      },
      notify() {},
    },
  };

  const start = registered.events.session_start({}, ctx);
  await registered.events.session_shutdown({ type: "session_shutdown", reason: "reload" }, {});
  await start;

  assert.deepEqual(widgets, []);
});

async function startSession() {
  const widgets = [];
  const notifications = [];
  const ctx = {
    hasUI: true,
    ui: {
      theme,
      setWidget(id, lines) {
        widgets.push({ id, lines });
      },
      notify(text, level = "info") {
        notifications.push({ text, level });
      },
    },
  };
  await registered.events.session_start({}, ctx);
  assert.equal(widgets.at(-1)?.id, "pi-soccer-widget");
  return { widgets, notifications };
}

for (const [name, fetchImpl] of [
  ["HTTP 500", async () => response(500, { message: "server error" })],
  ["rate limit 429", async () => response(429, { message: "rate limited" })],
  ["timeout abort", async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }],
]) {
  test(`stale snapshot renders when football-data fails with ${name}`, async () => {
    seedStaleCache(team(57, "Arsenal"));
    globalThis.fetch = fetchImpl;

    const { widgets } = await startSession();
    const lines = widgets.at(-1)?.lines ?? [];

    assert.match(lines.join("\n"), /Soccer: Arsenal \| PL/);
    assert.match(lines.join("\n"), /cache 2h ago/);
    assert.doesNotMatch(lines.join("\n"), /Soccer error/);
  });
}

test("one team match fetch failure does not fail the whole sync", async () => {
  rmSync(snapshotsFile, { force: true });
  const broken = team(1, "Broken FC");
  const healthy = team(2, "Healthy FC");
  seedConfig(broken, [healthy]);
  const today = new Date().toISOString().slice(0, 10);

  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes("/competitions/PL/standings")) {
      return response(200, {
        standings: [{
          type: "TOTAL",
          table: [
            { position: 1, points: 50, playedGames: 20, team: { id: 1, name: "Broken FC", shortName: "Broken", tla: "BRO" } },
            { position: 2, points: 48, playedGames: 20, team: { id: 2, name: "Healthy FC", shortName: "Healthy", tla: "HEA" } },
          ],
        }],
      });
    }
    if (path.includes("/competitions/SA/standings")) {
      return response(429, { message: "rate limited discovery" });
    }
    if (path.includes("/teams/1/matches")) {
      return response(500, { message: "team endpoint failed" });
    }
    if (path.includes("/teams/2/matches") && path.includes(`dateFrom=${today}`)) {
      return response(200, { matches: [{
        utcDate: "2026-05-30T18:00:00Z",
        status: "SCHEDULED",
        homeTeam: { id: 2, name: "Healthy FC", shortName: "Healthy" },
        awayTeam: { id: 3, name: "Next FC", shortName: "Next" },
        score: { winner: null, fullTime: { home: null, away: null } },
      }] });
    }
    if (path.includes("/teams/2/matches")) {
      return response(200, { matches: [{
        utcDate: "2026-05-20T18:00:00Z",
        status: "FINISHED",
        homeTeam: { id: 2, name: "Healthy FC", shortName: "Healthy" },
        awayTeam: { id: 4, name: "Past FC", shortName: "Past" },
        score: { winner: "HOME_TEAM", fullTime: { home: 2, away: 0 } },
      }] });
    }
    throw new Error(`unexpected URL: ${path}`);
  };

  await startSession();
  const cache = readJson(snapshotsFile);

  assert.equal(cache.snapshots["1"].team.name, "Broken FC");
  assert.equal(cache.snapshots["1"].lastResult, null);
  assert.equal(cache.snapshots["1"].nextMatch, null);
  assert.equal(cache.snapshots["2"].team.name, "Healthy FC");
  assert.equal(cache.snapshots["2"].lastResult?.wdl, "W");
  assert.equal(cache.snapshots["2"].nextMatch?.opponentShort, "Next");
});

test("session shutdown clears the refresh timer before the extension ctx goes stale", async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const timer = { unref() {} };
  const cleared = [];

  globalThis.setInterval = () => timer;
  globalThis.clearInterval = (handle) => {
    cleared.push(handle);
  };

  try {
    await startSession();

    assert.equal(typeof registered.events.session_shutdown, "function");
    await registered.events.session_shutdown({ type: "session_shutdown", reason: "reload" }, {});

    assert.deepEqual(cleared, [timer]);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test("refresh timer self-clears if it fires after the extension ctx goes stale", async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const timer = { unref() {} };
  const cleared = [];
  let tick;
  let stale = false;

  globalThis.setInterval = (fn) => {
    tick = fn;
    return timer;
  };
  globalThis.clearInterval = (handle) => {
    cleared.push(handle);
  };

  const ctx = {
    hasUI: true,
    get ui() {
      if (stale) {
        throw new Error("This extension ctx is stale after session replacement or reload.");
      }
      return {
        theme,
        setWidget() {},
        notify() {},
      };
    },
  };

  try {
    await registered.events.session_start({ type: "session_start", reason: "startup" }, ctx);

    stale = true;
    tick();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(cleared, [timer]);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
