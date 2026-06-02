import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function withSoccerCommands(fn) {
  const tmpHome = await mkdtemp(join(tmpdir(), "pi-soccer-widget-home-"));
  const previousEnv = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    FOOTBALL_DATA_API_TOKEN: process.env.FOOTBALL_DATA_API_TOKEN,
  };

  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete process.env.FOOTBALL_DATA_API_TOKEN;

  try {
    const moduleUrl = new URL(`../dist/extensions/index.js?home=${encodeURIComponent(tmpHome)}&t=${Date.now()}`, import.meta.url);
    const { default: soccerWidgetExtension } = await import(moduleUrl.href);
    const commands = new Map();
    soccerWidgetExtension({
      on() {},
      registerCommand(name, definition) {
        commands.set(name, definition);
      },
    });
    await fn(commands);
  } finally {
    if (previousEnv.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = previousEnv.HOME;
    if (previousEnv.USERPROFILE === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousEnv.USERPROFILE;
    if (previousEnv.FOOTBALL_DATA_API_TOKEN === undefined) delete process.env.FOOTBALL_DATA_API_TOKEN;
    else process.env.FOOTBALL_DATA_API_TOKEN = previousEnv.FOOTBALL_DATA_API_TOKEN;
    await rm(tmpHome, { recursive: true, force: true });
  }
}

function createCtx(inputValue) {
  const notifications = [];
  return {
    notifications,
    ctx: {
      hasUI: true,
      ui: {
        theme: { fg: (_color, text) => text },
        input: async () => inputValue,
        notify: (text, level) => notifications.push({ text, level }),
        setWidget() {},
      },
    },
  };
}

test("/soccer:status reports stored API key without exposing its value", async () => {
  await withSoccerCommands(async (commands) => {
    const storedSecret = "fd_test_stored_should_not_appear_1234567890";
    const login = commands.get("soccer:login");
    const status = commands.get("soccer:status");
    assert.ok(login, "soccer:login should be registered");
    assert.ok(status, "soccer:status should be registered");
    const { ctx, notifications } = createCtx(storedSecret);

    await login.handler("", ctx);
    notifications.length = 0;
    await status.handler("", ctx);

    const statusText = notifications.at(-1)?.text ?? "";
    assert.match(statusText, /configured via pi-soccer-widget login/);
    assert.equal(statusText.includes(storedSecret), false, "status must not include stored API key value");
  });
});

test("FOOTBALL_DATA_API_TOKEN takes priority and /soccer:status still hides secrets", async () => {
  await withSoccerCommands(async (commands) => {
    const storedSecret = "fd_test_stored_should_not_appear_abcdefghij";
    const envSecret = "fd_test_env_should_not_appear_0987654321";
    const login = commands.get("soccer:login");
    const status = commands.get("soccer:status");
    const { ctx, notifications } = createCtx(storedSecret);

    await login.handler("", ctx);
    process.env.FOOTBALL_DATA_API_TOKEN = envSecret;
    notifications.length = 0;
    await status.handler("", ctx);

    const statusText = notifications.at(-1)?.text ?? "";
    assert.match(statusText, /FOOTBALL_DATA_API_TOKEN environment variable/);
    assert.equal(statusText.includes(envSecret), false, "status must not include environment API key value");
    assert.equal(statusText.includes(storedSecret), false, "status must not include stored API key value");
  });
});

test("canonical /soccer:* commands are registered", async () => {
  await withSoccerCommands(async (commands) => {
    for (const name of [
      "soccer:setup",
      "soccer:login",
      "soccer:status",
      "soccer:logout",
      "soccer:sync",
      "soccer:search",
      "soccer:add",
      "soccer:favorite",
      "soccer:list",
      "soccer:remove",
      "soccer:worldcup",
    ]) {
      assert.ok(commands.has(name), `${name} should be registered`);
    }
    assert.equal(commands.has("soccer"), false, "legacy /soccer command should not be registered");
    assert.equal(commands.has("soccer:wc"), false, "soccer:wc alias should not be registered");
    assert.equal(commands.has("soccer:get-key"), false, "soccer:get-key alias should not be registered");
    assert.equal(commands.has("soccer:pick"), false, "soccer:pick alias should not be registered");
  });
});
