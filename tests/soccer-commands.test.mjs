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

function useFetchStub(handler = () => Promise.reject(new Error("Network access is disabled in tests."))) {
  fetchAttempts = [];
  globalThis.fetch = (input, init) => {
    const attempt = {
      url: String(input?.url ?? input),
      headers: init?.headers ?? {},
    };
    fetchAttempts.push(attempt);
    return handler(attempt);
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
    PI_SOCCER_LEAGUES: process.env.PI_SOCCER_LEAGUES,
  };

  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete process.env.FOOTBALL_DATA_API_TOKEN;
  delete process.env.PI_SOCCER_LEAGUES;

  const agentDir = join(tmpHome, ".pi", "agent");
  const authFile = join(agentDir, "pi-soccer-widget-auth.json");
  const configFile = join(agentDir, "pi-soccer-widget-config.json");
  const snapshotsFile = join(agentDir, "pi-soccer-widget-snapshots.json");

  useFetchStub();

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
    await fn({ commands, agentDir, authFile, configFile, snapshotsFile });
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
        input: async (...args) => typeof options.input === "function" ? options.input(...args) : options.input ?? "",
        select: async (...args) => typeof options.select === "function" ? options.select(...args) : options.select ?? null,
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

function useSoccerApiStub() {
  useFetchStub(({ url }) => {
    const path = new URL(url).pathname;
    if (path === "/v4/competitions/PL/teams") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ teams: [{ id: ARSENAL.teamId, name: "Arsenal FC", shortName: "Arsenal", tla: "ARS" }] }),
      });
    }
    if (path === "/v4/competitions/PL/standings") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ standings: [{
          type: "TOTAL",
          table: [{
            position: 1,
            points: 30,
            playedGames: 12,
            team: { id: ARSENAL.teamId, name: "Arsenal FC", shortName: "Arsenal", tla: "ARS" },
          }],
        }] }),
      });
    }
    if (path === `/v4/teams/${ARSENAL.teamId}/matches`) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ matches: [] }) });
    }
    return Promise.reject(new Error(`Unexpected API request in stub: ${url}`));
  });
}

function assertStubbedApiAttempts(token) {
  assert.ok(fetchAttempts.length > 0, "command should exercise the stubbed API");
  for (const attempt of fetchAttempts) {
    assert.match(attempt.url, /^https:\/\/api\.football-data\.org\/v4\//);
    assert.equal(attempt.headers["X-Auth-Token"], token, "API requests must use the configured test token");
    assert.ok(
      [
        "/v4/competitions/PL/teams",
        "/v4/competitions/PL/standings",
        `/v4/teams/${ARSENAL.teamId}/matches`,
      ].includes(new URL(attempt.url).pathname),
      `unexpected request reached the network stub: ${attempt.url}`,
    );
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

test("/soccer:setup guides API-key entry and team selection, then saves the favorite", async () => {
  await withSoccerCommands(async ({ commands, authFile, configFile }) => {
    const setup = commands.get("soccer:setup");
    assert.ok(setup, "soccer:setup should be registered");
    process.env.PI_SOCCER_LEAGUES = "PL";
    const apiKey = "fd_test_setup_key_1234567890";
    const answers = [apiKey, "Arsenal"];
    const prompts = [];
    const selections = [];
    useSoccerApiStub();
    const { ctx, notifications, widgets } = createCtx({
      input: async (prompt) => {
        prompts.push(prompt);
        return answers.shift();
      },
      select: async (title, items) => {
        selections.push({ title, items });
        return items[0];
      },
    });

    await setup.handler("", ctx);

    assert.match(prompts[0], /API key/);
    assert.match(prompts[1], /Search soccer team/);
    assert.equal(selections.length, 1);
    assert.equal(selections[0].title, "Choose favorite team:");
    assert.deepEqual(selections[0].items, ["Arsenal FC | PL | ARS"]);
    assert.equal(readJson(authFile).key, apiKey);
    const saved = readJson(configFile);
    assert.equal(saved.favoriteTeamId, ARSENAL.teamId);
    assert.deepEqual(saved.teams.map((team) => team.teamId), [ARSENAL.teamId]);
    assert.ok(notifications.some(({ text }) => text.includes("Saved Football-data API key.")));
    assert.deepEqual(notifications.at(-1), { text: "Favorite set: Arsenal | PL | ARS", level: "info" });
    assert.ok(widgets.length > 0, "setup refreshes the widget after saving the favorite");
    assertStubbedApiAttempts(apiKey);
    assert.ok(fetchAttempts.some(({ url }) => url.endsWith("/competitions/PL/teams")));
  });
});

test("/soccer:setup does not save an empty API key or continue to team selection", async () => {
  await withSoccerCommands(async ({ commands, authFile, configFile }) => {
    const setup = commands.get("soccer:setup");
    const selections = [];
    const { ctx, notifications } = createCtx({
      input: async () => "   ",
      select: async (...args) => selections.push(args),
    });

    await setup.handler("", ctx);

    assert.ok(notifications.some(({ text, level }) => text === "API key was not saved." && level === "warning"));
    assert.deepEqual(notifications.at(-1), {
      text: "Football-data API key is not set. Run /soccer:setup.",
      level: "warning",
    });
    assert.equal(existsSync(authFile), false);
    assert.equal(existsSync(configFile), false);
    assert.deepEqual(selections, []);
    assert.equal(fetchAttempts.length, 0);
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

test("/soccer:add searches through the picker, saves the selected team and refreshes", async () => {
  await withSoccerCommands(async ({ commands, configFile }) => {
    const add = commands.get("soccer:add");
    const apiKey = "fd_test_add_key_1234567890";
    process.env.FOOTBALL_DATA_API_TOKEN = apiKey;
    process.env.PI_SOCCER_LEAGUES = "PL";
    const selections = [];
    useSoccerApiStub();
    const { ctx, notifications, widgets } = createCtx({
      input: async () => "Arsenal",
      select: async (title, items) => {
        selections.push({ title, items });
        return items[0];
      },
    });

    await add.handler("", ctx);

    assert.deepEqual(selections, [{ title: "Add team to watchlist:", items: ["Arsenal FC | PL | ARS"] }]);
    const saved = readJson(configFile);
    assert.equal(saved.favoriteTeamId, ARSENAL.teamId);
    assert.deepEqual(saved.teams.map((team) => team.teamId), [ARSENAL.teamId]);
    assert.deepEqual(notifications[0], { text: "Added: Arsenal | PL | ARS", level: "info" });
    assert.ok(widgets.length > 0, "adding a team refreshes the widget");
    assertStubbedApiAttempts(apiKey);
    assert.ok(fetchAttempts.some(({ url }) => url.endsWith("/competitions/PL/teams")));
  });
});

test("/soccer:add rejects numeric IDs without changing the watchlist", async () => {
  await withSoccerCommands(async ({ commands, configFile }) => {
    const add = commands.get("soccer:add");
    process.env.FOOTBALL_DATA_API_TOKEN = "fd_test_add_numeric_key_1234567890";
    const { ctx, notifications } = createCtx();

    await add.handler("57", ctx);

    assert.deepEqual(notifications.at(-1), {
      text: "Numeric team IDs are no longer supported. Use a team name, or run the command without arguments to pick from the UI.",
      level: "warning",
    });
    assert.equal(existsSync(configFile), false);
    assert.equal(fetchAttempts.length, 0, "invalid numeric input must not make a network request");
  });
});

test("/soccer:sync refreshes cached data and reports the discovered league", async () => {
  await withSoccerCommands(async ({ commands, configFile, snapshotsFile }) => {
    const sync = commands.get("soccer:sync");
    const apiKey = "fd_test_sync_key_1234567890";
    process.env.FOOTBALL_DATA_API_TOKEN = apiKey;
    process.env.PI_SOCCER_LEAGUES = "PL";
    writeConfig(configFile, [ARSENAL], ARSENAL.teamId);
    useSoccerApiStub();
    const { ctx, notifications, widgets } = createCtx();

    await sync.handler("", ctx);

    const snapshot = readJson(snapshotsFile).snapshots[String(ARSENAL.teamId)];
    assert.equal(snapshot.team.name, "Arsenal FC");
    assert.deepEqual(snapshot.standing, { position: 1, points: 30, playedGames: 12 });
    assert.deepEqual(notifications.at(-1), { text: "Soccer data synced. Discovery league: PL", level: "info" });
    assert.ok(widgets.length > 0, "sync refreshes the widget after updating cached data");
    assertStubbedApiAttempts(apiKey);
    assert.ok(fetchAttempts.some(({ url }) => url.includes("/competitions/PL/standings")));
    assert.ok(fetchAttempts.some(({ url }) => url.includes(`/teams/${ARSENAL.teamId}/matches`)));
  });
});

test("/soccer:sync warns and renders the missing-key state without network access", async () => {
  await withSoccerCommands(async ({ commands, configFile }) => {
    const sync = commands.get("soccer:sync");
    writeConfig(configFile, [ARSENAL], ARSENAL.teamId);
    const { ctx, notifications, widgets } = createCtx();

    await sync.handler("", ctx);

    assert.deepEqual(notifications.at(-1), {
      text: "Football-data API key is not set. Run /soccer:setup.",
      level: "warning",
    });
    assert.match(widgets.at(-1).lines.join("\n"), /API key not set/);
    assert.equal(fetchAttempts.length, 0);
  });
});
