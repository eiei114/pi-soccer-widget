import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function withSoccerCommand(fn) {
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
    const command = commands.get("soccer");
    assert.ok(command, "soccer command should be registered");
    await fn(command);
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

test("/soccer status reports stored API key without exposing its value", async () => {
  await withSoccerCommand(async (command) => {
    const storedSecret = "fd_test_stored_should_not_appear_1234567890";
    const { ctx, notifications } = createCtx(storedSecret);

    await command.handler("login", ctx);
    notifications.length = 0;
    await command.handler("status", ctx);

    const status = notifications.at(-1)?.text ?? "";
    assert.match(status, /configured via pi-soccer-widget login/);
    assert.equal(status.includes(storedSecret), false, "status must not include stored API key value");
  });
});

test("FOOTBALL_DATA_API_TOKEN takes priority and status still hides secrets", async () => {
  await withSoccerCommand(async (command) => {
    const storedSecret = "fd_test_stored_should_not_appear_abcdefghij";
    const envSecret = "fd_test_env_should_not_appear_0987654321";
    const { ctx, notifications } = createCtx(storedSecret);

    await command.handler("login", ctx);
    process.env.FOOTBALL_DATA_API_TOKEN = envSecret;
    notifications.length = 0;
    await command.handler("status", ctx);

    const status = notifications.at(-1)?.text ?? "";
    assert.match(status, /FOOTBALL_DATA_API_TOKEN environment variable/);
    assert.equal(status.includes(envSecret), false, "status must not include environment API key value");
    assert.equal(status.includes(storedSecret), false, "status must not include stored API key value");
  });
});
