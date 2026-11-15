import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

/**
 * Command-handler coverage for /soccer:login, /soccer:logout, /soccer:list and
 * /soccer:remove.
 *
 * Every test runs against a throwaway HOME/USERPROFILE and a failing fetch
 * stub, so no state leaks into the real ~/.pi/agent and no request can reach
 * api.football-data.org. The stub records the attempted URLs so the tests can
 * assert that command paths such as /soccer:list never even try to fetch.
 */

const originalFetch = globalThis.fetch;
let testRun = 0;
let fetchAttempts = [];

function useFailingFetch() {
  fetchAttempts = [];
  globalThis.fetch = (input, init) => {
    fetchAttempts.push({
      url: String(input?.url ?? input),
      headers: init?.headers ?? {},
    });
    return Promise.reject(new Error("Network access is disabled in tests."));
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function withSoccerCommands(fn) {
  const tmpHome = mkdtempSync(join(tmpdir(), "pi-soccer-widget-commands-"));
  const previousEnv = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    FOOTBALL_DATA_API_TOKEN: process.env.FOOTBALL_DATA_API_TOKEN,
  };

  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete process.env.FOOTBALL_DATA_API_TOKEN;

  const agentDir = join(tmpHome, ".pi", "agent");
  const authFile = join(agentDir, "pi-soccer-widget-auth.json");
  const configFile = join(agentDir, "pi-soccer-widget-config.json");

  useFailingFetch();

  try {
    const moduleUrl = new URL(
      `../dist/extensions/index.js?home=${encodeURIComponent(tmpHome)}&run=${testRun++}&t=${Date.now()}`,
      import.meta.url,
    );
    const { default: soccerWidgetExtension } = await import(moduleUrl.href);
    const commands = new Map();
    soccerWidgetExtension({
      on() {},
      registerCommand(name, definition) {
        commands.set(name, definition);
      },
    });
    await fn({ commands, agentDir, authFile, configFile });
  } finally {
    restoreFetch();
    for (const [name, value] of Object.entries(previousEnv)) restoreEnv(name, value);
    rmSync(tmpHome, { recursive: true, force: true });
  }
}

function createCtx(options = {}) {
  const notifications = [];
  const widgets = [];
  return {
    notifications,
    widgets,
    ctx: {
      hasUI: true,
      ui: {
        theme: { fg: (_color, text) => text },
        input: async () => options.input ?? "",
        notify: (text, level = "info") => notifications.push({ text, level }),
        setWidget: (id, lines) => widgets.push({ id, lines }),
      },
    },
  };
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf-8"));
}

const REAL_MADRID = { teamId: 86, name: "Real Madrid", shortName: "Real Madrid", tla: "RMA", leagueCode: "PD" };
const BARCELONA = { teamId: 81, name: "Barcelona", shortName: "Barcelona", tla: "BAR", leagueCode: "PD" };
const ARSENAL = { teamId: 57, name: "Arsenal", shortName: "Arsenal", tla: "ARS", leagueCode: "PL" };

function writeConfig(configFile, teams, favoriteTeamId) {
  writeJson(configFile, {
    favoriteTeamId,
    teams,
    updatedAt: "2026-11-15T00:00:00.000Z",
  });
}

function assertOnlyApiBaseAttempts() {
  for (const attempt of fetchAttempts) {
    assert.match(
      attempt.url,
      /^https:\/\/api\.football-data\.org\/v4\//,
      `unexpected request target during command test: ${attempt.url}`,
    );
    // The stub rejected every attempt, so nothing left the process.
    assert.ok(attempt.headers["X-Auth-Token"], "API requests must carry the configured token");
  }
}

test("/soccer:login does not save an empty API key", async () => {
  await withSoccerCommands(async ({ commands, authFile }) => {
    const login = commands.get("soccer:login");
    assert.ok(login, "soccer:login should be registered");
    const { ctx, notifications } = createCtx({ input: "   " });

    await login.handler("", ctx);

    assert.deepEqual(notifications.at(-1), { text: "API key was not saved.", level: "warning" });
    assert.equal(existsSync(authFile), false, "an empty key must not create an auth file");
    assert.equal(fetchAttempts.length, 0, "login must not perform network requests");
  });
});

test("/soccer:login stores the API key without echoing it", async () => {
  await withSoccerCommands(async ({ commands, authFile }) => {
    const login = commands.get("soccer:login");
    const apiKey = "fd_test_login_key_1234567890";
    const { ctx, notifications } = createCtx({ input: `  ${apiKey}  ` });

    await login.handler("", ctx);

    const notification = notifications.at(-1);
    assert.equal(notification.level, "info");
    assert.match(notification.text, /Saved Football-data API key for pi-soccer-widget/);
    assert.equal(notification.text.includes(apiKey), false, "the saved key must not be echoed");

    const stored = readJson(authFile);
    assert.equal(stored.type, "api_key");
    assert.equal(stored.key, apiKey, "the entered key is persisted after trimming");
    assert.equal(typeof stored.updatedAt, "string");
    assert.equal(fetchAttempts.length, 0, "login must not perform network requests");
  });
});

test("/soccer:logout removes the stored key, keeps env vars and is idempotent", async () => {
  await withSoccerCommands(async ({ commands, authFile }) => {
    const login = commands.get("soccer:login");
    const logout = commands.get("soccer:logout");
    const apiKey = "fd_test_logout_key_1234567890";
    const envToken = "fd_test_env_token_0987654321";
    process.env.FOOTBALL_DATA_API_TOKEN = envToken;

    await login.handler("", createCtx({ input: apiKey }).ctx);
    assert.equal(existsSync(authFile), true, "login should create the auth file");

    const { ctx, notifications } = createCtx();

    await logout.handler("", ctx);

    assert.equal(existsSync(authFile), false, "logout should delete the auth file");
    assert.deepEqual(notifications.at(-1), {
      text: "Removed stored pi-soccer-widget API key. Environment variables are unchanged.",
      level: "info",
    });
    assert.equal(
      process.env.FOOTBALL_DATA_API_TOKEN,
      envToken,
      "logout must not touch FOOTBALL_DATA_API_TOKEN",
    );

    await logout.handler("", ctx);

    assert.deepEqual(notifications.at(-1), {
      text: "Removed stored pi-soccer-widget API key. Environment variables are unchanged.",
      level: "info",
    });
    assert.equal(existsSync(authFile), false, "a second logout is harmless");
    assert.equal(process.env.FOOTBALL_DATA_API_TOKEN, envToken);
    assert.equal(fetchAttempts.length, 0, "logout must not perform network requests");
  });
});

test("/soccer:list warns when the watchlist is empty", async () => {
  await withSoccerCommands(async ({ commands, configFile }) => {
    const list = commands.get("soccer:list");
    process.env.FOOTBALL_DATA_API_TOKEN = "fd_test_dummy_token_list_empty";
    const { ctx, notifications } = createCtx();

    await list.handler("", ctx);

    assert.deepEqual(notifications.at(-1), {
      text: "No teams in watchlist. Run /soccer:add.",
      level: "warning",
    });
    assert.equal(existsSync(configFile), false, "list must not create a config file");
    assert.equal(fetchAttempts.length, 0, "list must not perform network requests");
  });
});

test("/soccer:list prints the watchlist and marks only the favorite", async () => {
  await withSoccerCommands(async ({ commands, configFile }) => {
    const list = commands.get("soccer:list");
    process.env.FOOTBALL_DATA_API_TOKEN = "fd_test_dummy_token_list";
    writeConfig(configFile, [REAL_MADRID, BARCELONA, ARSENAL], REAL_MADRID.teamId);
    const before = readFileSync(configFile, "utf-8");
    const { ctx, notifications } = createCtx();

    await list.handler("", ctx);

    const notification = notifications.at(-1);
    assert.equal(notification.level, "info");
    const expected = [
      "Soccer watchlist:",
      "- Real Madrid | PD | RMA (favorite)",
      "- Barcelona | PD | BAR",
      "- Arsenal | PL | ARS",
    ].join("\n");
    assert.equal(notification.text, expected);
    assert.equal(notification.text.includes("Barcelona | PD | BAR (favorite)"), false);
    assert.equal(notification.text.includes("Arsenal | PL | ARS (favorite)"), false);
    assert.equal(readFileSync(configFile, "utf-8"), before, "list must not mutate the config file");
    assert.equal(fetchAttempts.length, 0, "list must not perform network requests");
  });
});

test("/soccer:list requires a configured API key", async () => {
  await withSoccerCommands(async ({ commands, configFile }) => {
    const list = commands.get("soccer:list");
    writeConfig(configFile, [REAL_MADRID], REAL_MADRID.teamId);
    const { ctx, notifications } = createCtx();

    await list.handler("", ctx);

    assert.deepEqual(notifications.at(-1), {
      text: "Football-data API key is not set. Run /soccer:setup.",
      level: "warning",
    });
    assert.equal(fetchAttempts.length, 0, "list must not perform network requests");
  });
});

test("/soccer:remove reassigns the favorite to the next remaining team", async () => {
  await withSoccerCommands(async ({ commands, configFile }) => {
    const remove = commands.get("soccer:remove");
    process.env.FOOTBALL_DATA_API_TOKEN = "fd_test_dummy_token_remove";
    writeConfig(configFile, [REAL_MADRID, BARCELONA, ARSENAL], REAL_MADRID.teamId);
    const { ctx, notifications } = createCtx();

    await remove.handler("Real Madrid", ctx);

    assert.deepEqual(notifications.at(-1), {
      text: "Removed: Real Madrid | PD | RMA",
      level: "info",
    });

    const saved = readJson(configFile);
    assert.deepEqual(saved.teams.map((team) => team.teamId), [BARCELONA.teamId, ARSENAL.teamId]);
    assert.equal(saved.favoriteTeamId, BARCELONA.teamId, "favorite must move to the next remaining team");
    assertOnlyApiBaseAttempts();
  });
});

test("/soccer:remove keeps the favorite when another team is removed", async () => {
  await withSoccerCommands(async ({ commands, configFile }) => {
    const remove = commands.get("soccer:remove");
    process.env.FOOTBALL_DATA_API_TOKEN = "fd_test_dummy_token_remove_other";
    writeConfig(configFile, [REAL_MADRID, BARCELONA], REAL_MADRID.teamId);
    const { ctx, notifications } = createCtx();

    await remove.handler("Barcelona", ctx);

    assert.deepEqual(notifications.at(-1), {
      text: "Removed: Barcelona | PD | BAR",
      level: "info",
    });

    const saved = readJson(configFile);
    assert.deepEqual(saved.teams.map((team) => team.teamId), [REAL_MADRID.teamId]);
    assert.equal(saved.favoriteTeamId, REAL_MADRID.teamId, "removing a non-favorite must not move the favorite");
    assertOnlyApiBaseAttempts();
  });
});

test("/soccer:remove of the last team clears the favorite and the widget", async () => {
  await withSoccerCommands(async ({ commands, configFile }) => {
    const remove = commands.get("soccer:remove");
    process.env.FOOTBALL_DATA_API_TOKEN = "fd_test_dummy_token_remove_last";
    writeConfig(configFile, [REAL_MADRID], REAL_MADRID.teamId);
    const { ctx, notifications, widgets } = createCtx();

    await remove.handler("Real Madrid", ctx);

    assert.deepEqual(notifications.at(-1), {
      text: "Removed: Real Madrid | PD | RMA",
      level: "info",
    });

    const saved = readJson(configFile);
    assert.deepEqual(saved.teams, []);
    assert.equal(saved.favoriteTeamId, null, "removing the last team must clear favoriteTeamId");
    assert.match(widgets.at(-1).lines.join("\n"), /Soccer: no favorite team yet/);
    assert.equal(fetchAttempts.length, 0, "an empty watchlist must not trigger a sync");
  });
});

test("/soccer:remove warns for an unknown name and leaves the config untouched", async () => {
  await withSoccerCommands(async ({ commands, configFile }) => {
    const remove = commands.get("soccer:remove");
    process.env.FOOTBALL_DATA_API_TOKEN = "fd_test_dummy_token_remove_unknown";
    writeConfig(configFile, [REAL_MADRID, BARCELONA], REAL_MADRID.teamId);
    const before = readFileSync(configFile, "utf-8");
    const { ctx, notifications } = createCtx();

    await remove.handler("Chelsea", ctx);

    assert.deepEqual(notifications.at(-1), {
      text: 'No watchlist team matches "Chelsea".',
      level: "warning",
    });
    assert.equal(readFileSync(configFile, "utf-8"), before, "unknown names must not rewrite the config");
    assert.equal(readJson(configFile).favoriteTeamId, REAL_MADRID.teamId);
    assert.equal(fetchAttempts.length, 0, "an unknown name must not trigger a sync");
  });
});

test("/soccer:remove without an API key warns and keeps the watchlist", async () => {
  await withSoccerCommands(async ({ commands, configFile }) => {
    const remove = commands.get("soccer:remove");
    writeConfig(configFile, [REAL_MADRID], REAL_MADRID.teamId);
    const before = readFileSync(configFile, "utf-8");
    const { ctx, notifications } = createCtx();

    await remove.handler("Real Madrid", ctx);

    assert.deepEqual(notifications.at(-1), {
      text: "Football-data API key is not set. Run /soccer:setup.",
      level: "warning",
    });
    assert.equal(readFileSync(configFile, "utf-8"), before);
    assert.equal(fetchAttempts.length, 0, "a missing token must not trigger a sync");
  });
});
