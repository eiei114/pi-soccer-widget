import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

/**
 * Config migration and normalization coverage for readConfig().
 *
 * readConfig() is module-private, so every case is driven through the public
 * surface: register the extension, fire the registered `session_start` handler
 * with a UI-capable ctx whose `ui.setWidget` is a stub, then inspect the files
 * under `<HOME>/.pi/agent/` plus the widget output. `/soccer:list` is used to
 * confirm the in-memory config that commands actually see. `fetch` always
 * rejects, so the first widget refresh cannot reach api.football-data.org.
 *
 * `__testing.readConfig` is the same module-private function, exported unchanged
 * for assertions that the widget path cannot expose (dedup results, World Cup
 * normalization). It must stay side-effect free apart from the documented
 * legacy migration write.
 */

const originalFetch = globalThis.fetch;
const registrySymbol = Symbol.for("pi-widget-host.registry.v1");
const presenceSymbol = Symbol.for("pi-widget-host.presence.v1");
const THEME = { fg: (_color, text) => text };

const REAL_MADRID = { teamId: 86, name: "Real Madrid", shortName: "Real Madrid", tla: "RMA", leagueCode: "PD" };
const BARCELONA = { teamId: 81, name: "Barcelona", shortName: "Barcelona", tla: "BAR", leagueCode: "PD" };
const JAPAN = { teamId: 900017, name: "Japan", shortName: "Japan", tla: "JPN", leagueCode: "WC" };
const BRAZIL = { teamId: 900004, name: "Brazil", shortName: "Brazil", tla: "BRA", leagueCode: "WC" };

let testRun = 0;

function resetHostGlobals() {
  delete globalThis[registrySymbol];
  delete globalThis[presenceSymbol];
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function useFailingFetch() {
  const attempts = [];
  globalThis.fetch = (input, init) => {
    attempts.push({ url: String(input?.url ?? input), headers: init?.headers ?? {} });
    return Promise.reject(new Error("Network access is disabled in tests."));
  };
  return attempts;
}

async function withConfigExtension(fn) {
  const tmpHome = mkdtempSync(join(tmpdir(), "pi-soccer-widget-config-"));
  const previousEnv = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    FOOTBALL_DATA_API_TOKEN: process.env.FOOTBALL_DATA_API_TOKEN,
    PI_SOCCER_LEAGUES: process.env.PI_SOCCER_LEAGUES,
    PI_SOCCER_COUNTRY: process.env.PI_SOCCER_COUNTRY,
  };

  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete process.env.FOOTBALL_DATA_API_TOKEN;
  delete process.env.PI_SOCCER_LEAGUES;
  delete process.env.PI_SOCCER_COUNTRY;

  const agentDir = join(tmpHome, ".pi", "agent");
  const configFile = join(agentDir, "pi-soccer-widget-config.json");
  const legacyFile = join(agentDir, "soccer-team.json");
  const fetchAttempts = useFailingFetch();
  resetHostGlobals();

  try {
    // A fresh module instance per test so module-level currentConfig cannot leak.
    const extensionUrl = pathToFileURL(join(process.cwd(), "dist", "extensions", "index.js"));
    extensionUrl.searchParams.set("configMigrationRun", String(testRun++));
    const { default: soccerWidgetExtension, __testing } = await import(extensionUrl.href);

    const events = {};
    const commands = new Map();
    soccerWidgetExtension({
      on(name, handler) {
        events[name] = handler;
      },
      registerCommand(name, definition) {
        commands.set(name, definition);
      },
    });

    await fn({ events, commands, testing: __testing, agentDir, configFile, legacyFile, fetchAttempts });
  } finally {
    globalThis.fetch = originalFetch;
    resetHostGlobals();
    for (const [name, value] of Object.entries(previousEnv)) restoreEnv(name, value);
    rmSync(tmpHome, { recursive: true, force: true });
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
}

function writeRaw(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, "utf-8");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf-8"));
}

function readRaw(file) {
  return existsSync(file) ? readFileSync(file, "utf-8") : undefined;
}

function createSessionCtx() {
  const widgets = [];
  const notifications = [];
  const ctx = {
    hasUI: true,
    ui: {
      theme: THEME,
      setWidget(id, lines) {
        widgets.push({ id, lines });
      },
      notify(text, level = "info") {
        notifications.push({ text, level });
      },
    },
  };
  return { ctx, widgets, notifications };
}

async function startSession(events) {
  const { ctx, widgets, notifications } = createSessionCtx();
  await events.session_start({ type: "session_start", reason: "startup" }, ctx);
  return { ctx, widgets, notifications };
}

async function stopSession(events) {
  await events.session_shutdown({ type: "session_shutdown", reason: "reload" }, {});
}

function assertNoNetwork(fetchAttempts) {
  assert.equal(fetchAttempts.length, 0, "the config path must not perform network requests");
}

test("legacy soccer-team.json is migrated into pi-soccer-widget-config.json on disk", async () => {
  await withConfigExtension(async ({ events, testing, configFile, legacyFile, fetchAttempts }) => {
    writeJson(legacyFile, { team: "Barcelona", teamId: BARCELONA.teamId, leagueCode: "PD" });
    const legacyBefore = readRaw(legacyFile);
    assert.equal(existsSync(configFile), false, "the new config must not exist before the session starts");

    const { widgets } = await startSession(events);

    assert.match((widgets.at(-1)?.lines ?? []).join("\n"), /Soccer: API key not set/);
    assertNoNetwork(fetchAttempts);
    assert.equal(existsSync(configFile), true, "the legacy config must be migrated to the new file");

    const saved = readJson(configFile);
    assert.equal(saved.favoriteTeamId, BARCELONA.teamId, "the legacy teamId becomes the favorite");
    assert.equal(saved.teams.length, 1);
    assert.equal(saved.teams[0].name, "Barcelona", "teams[0].name comes from the legacy team field");
    assert.equal(saved.teams[0].leagueCode, "PD", "the legacy leagueCode is preserved");
    assert.equal(saved.teams[0].tla, "", "the legacy format carries no tla");
    assert.equal(typeof saved.updatedAt, "string");

    assert.equal(readRaw(legacyFile), legacyBefore, "the legacy file must be left untouched");
    assert.equal(readJson(legacyFile).teamId, BARCELONA.teamId);

    const reread = testing.readConfig();
    assert.equal(reread.favoriteTeamId, BARCELONA.teamId);
    assert.deepEqual(reread.teams.map((team) => team.teamId), [BARCELONA.teamId]);
    assert.equal(reread.worldCup, undefined, "a migrated config has no World Cup block");

    await stopSession(events);
  });
});

test("an existing config wins over the legacy file and neither file is rewritten", async () => {
  await withConfigExtension(async ({ events, testing, configFile, legacyFile, fetchAttempts }) => {
    writeJson(configFile, {
      favoriteTeamId: BARCELONA.teamId,
      teams: [REAL_MADRID, BARCELONA],
      updatedAt: "2026-11-15T00:00:00.000Z",
    });
    writeJson(legacyFile, { team: "Arsenal", teamId: 57, leagueCode: "PL" });
    const configBefore = readRaw(configFile);
    const legacyBefore = readRaw(legacyFile);

    await startSession(events);

    assert.equal(readRaw(configFile), configBefore, "an existing config must not be rewritten");
    assert.equal(readRaw(legacyFile), legacyBefore, "an ignored legacy file must not be touched");
    assertNoNetwork(fetchAttempts);

    const config = testing.readConfig();
    assert.equal(config.favoriteTeamId, BARCELONA.teamId, "the new config favorite is kept");
    assert.deepEqual(config.teams.map((team) => team.teamId), [REAL_MADRID.teamId, BARCELONA.teamId]);
    assert.equal(
      config.teams.some((team) => team.teamId === 57),
      false,
      "the legacy team must not be merged into an existing config",
    );
    assert.equal(config.updatedAt, "2026-11-15T00:00:00.000Z", "the stored updatedAt is kept");

    await stopSession(events);
  });
});

test("duplicate teamId entries are de-duplicated and the favorite falls back to the first team", async () => {
  await withConfigExtension(async ({ events, commands, testing, configFile, fetchAttempts }) => {
    writeJson(configFile, {
      teams: [
        REAL_MADRID,
        { teamId: REAL_MADRID.teamId, name: "Real Madrid Castilla", shortName: "Castilla", tla: "RMC", leagueCode: "PD" },
        BARCELONA,
      ],
      updatedAt: "2026-11-15T00:00:00.000Z",
    });
    const configBefore = readRaw(configFile);

    await startSession(events);
    assert.equal(readRaw(configFile), configBefore, "normalization on read must not rewrite the file");

    const config = testing.readConfig();
    assert.deepEqual(config.teams.map((team) => team.teamId), [REAL_MADRID.teamId, BARCELONA.teamId]);
    assert.equal(config.teams[0].name, "Real Madrid", "the first occurrence of a duplicate teamId wins");
    assert.equal(config.favoriteTeamId, REAL_MADRID.teamId, "a missing favorite falls back to the first team");

    // The command surface proves it sees the same normalized in-memory config.
    process.env.FOOTBALL_DATA_API_TOKEN = "fd_test_config_migration_list";
    const { ctx, notifications } = createSessionCtx();
    await commands.get("soccer:list").handler("", ctx);

    assert.deepEqual(notifications.at(-1), {
      text: [
        "Soccer watchlist:",
        "- Real Madrid | PD | RMA (favorite)",
        "- Barcelona | PD | BAR",
      ].join("\n"),
      level: "info",
    });
    assert.equal(notifications.at(-1).text.includes("Castilla"), false, "duplicates must not be listed");
    delete process.env.FOOTBALL_DATA_API_TOKEN;

    assertNoNetwork(fetchAttempts);

    await stopSession(events);
  });
});

test("malformed config JSON falls back to the legacy file instead of throwing", async () => {
  await withConfigExtension(async ({ events, testing, configFile, legacyFile, fetchAttempts }) => {
    writeRaw(configFile, "{ this is not json");
    writeJson(legacyFile, { team: "Barcelona", teamId: BARCELONA.teamId, leagueCode: "PD" });
    const legacyBefore = readRaw(legacyFile);

    await startSession(events);
    assertNoNetwork(fetchAttempts);

    const migrated = readJson(configFile);
    assert.equal(migrated.favoriteTeamId, BARCELONA.teamId);
    assert.deepEqual(migrated.teams.map((team) => team.teamId), [BARCELONA.teamId]);
    assert.equal(readRaw(legacyFile), legacyBefore, "the legacy source stays untouched");

    const config = testing.readConfig();
    assert.equal(config.favoriteTeamId, BARCELONA.teamId);
    assert.equal(config.teams[0].leagueCode, "PD");

    await stopSession(events);
  });
});

test("a config whose teams field is not an array falls back to the legacy file", async () => {
  await withConfigExtension(async ({ events, testing, configFile, legacyFile, fetchAttempts }) => {
    writeJson(configFile, { favoriteTeamId: 1, teams: { teamId: 1 }, updatedAt: "2026-11-15T00:00:00.000Z" });
    writeJson(legacyFile, { team: "Barcelona", teamId: BARCELONA.teamId, leagueCode: "PD" });
    const legacyBefore = readRaw(legacyFile);

    await startSession(events);
    assertNoNetwork(fetchAttempts);

    const migrated = readJson(configFile);
    assert.equal(migrated.favoriteTeamId, BARCELONA.teamId, "the invalid config is replaced by the migration result");
    assert.deepEqual(migrated.teams.map((team) => team.teamId), [BARCELONA.teamId]);
    assert.equal(readRaw(legacyFile), legacyBefore);

    await stopSession(events);
  });
});

test("malformed JSON without a legacy file yields an empty config without throwing or rewriting", async () => {
  await withConfigExtension(async ({ events, testing, configFile, fetchAttempts }) => {
    writeRaw(configFile, "{ this is not json");
    const configBefore = readRaw(configFile);

    const { widgets } = await startSession(events);

    assert.match((widgets.at(-1)?.lines ?? []).join("\n"), /Soccer: API key not set/);
    assertNoNetwork(fetchAttempts);
    assert.equal(readRaw(configFile), configBefore, "an unreadable config must not be silently rewritten");

    const config = testing.readConfig();
    assert.equal(config.favoriteTeamId, null);
    assert.deepEqual(config.teams, []);
    assert.equal(config.worldCup, undefined);
    assert.equal(typeof config.updatedAt, "string");

    await stopSession(events);
  });
});

test("a World Cup block keeps one entry per teamId, forces the WC league code and defaults the followed team", async () => {
  await withConfigExtension(async ({ events, testing, configFile, fetchAttempts }) => {
    writeJson(configFile, {
      favoriteTeamId: REAL_MADRID.teamId,
      teams: [REAL_MADRID],
      worldCup: {
        teams: [
          { ...JAPAN, leagueCode: "PD" },
          { ...JAPAN, name: "Japan B", shortName: "Japan B", leagueCode: "JP1" },
          BRAZIL,
        ],
        updatedAt: "2026-11-15T00:00:00.000Z",
      },
      updatedAt: "2026-11-15T00:00:00.000Z",
    });
    const configBefore = readRaw(configFile);

    await startSession(events);
    assertNoNetwork(fetchAttempts);
    assert.equal(readRaw(configFile), configBefore, "World Cup normalization on read must not rewrite the file");

    const config = testing.readConfig();
    const worldCup = config.worldCup;
    assert.ok(worldCup, "the World Cup block must survive normalization");
    assert.deepEqual(worldCup.teams.map((team) => team.teamId), [JAPAN.teamId, BRAZIL.teamId]);
    assert.deepEqual(worldCup.teams.map((team) => team.name), ["Japan", "Brazil"], "the first duplicate wins");
    assert.deepEqual(
      worldCup.teams.map((team) => team.leagueCode),
      ["WC", "WC"],
      "every World Cup team is forced to the WC league code",
    );
    assert.equal(worldCup.followedTeamId, JAPAN.teamId, "a missing followedTeamId defaults to the first team");
    assert.equal(worldCup.countryCode, "JPN", "the country code falls back to the followed team tla");
    assert.equal(worldCup.updatedAt, "2026-11-15T00:00:00.000Z");

    const followed = testing.followedWorldCupTeam(config);
    assert.equal(followed?.teamId, JAPAN.teamId);
    assert.equal(followed?.leagueCode, "WC");

    await stopSession(events);
  });
});
