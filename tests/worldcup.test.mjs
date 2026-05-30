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
    PI_SOCCER_CHAMPIONS_FORCE: process.env.PI_SOCCER_CHAMPIONS_FORCE,
    PI_SOCCER_DISABLE_OPEN: process.env.PI_SOCCER_DISABLE_OPEN,
    PI_SOCCER_AI_PROVIDER: process.env.PI_SOCCER_AI_PROVIDER,
    PI_SOCCER_AI_MODEL: process.env.PI_SOCCER_AI_MODEL,
    PI_SOCCER_AI_ANALYSIS_RESPONSE: process.env.PI_SOCCER_AI_ANALYSIS_RESPONSE,
    PI_SOCCER_AI_RESPONSE: process.env.PI_SOCCER_AI_RESPONSE,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    LC_MESSAGES: process.env.LC_MESSAGES,
    TZ: process.env.TZ,
  };

  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete process.env.FOOTBALL_DATA_API_TOKEN;
  delete process.env.PI_SOCCER_COUNTRY;
  process.env.PI_SOCCER_CHAMPIONS_FORCE = "off";
  process.env.PI_SOCCER_DISABLE_OPEN = "1";
  delete process.env.PI_SOCCER_AI_PROVIDER;
  delete process.env.PI_SOCCER_AI_MODEL;
  delete process.env.PI_SOCCER_AI_ANALYSIS_RESPONSE;
  delete process.env.PI_SOCCER_AI_RESPONSE;
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

test("/soccer:champions and /soccer:ucl render the Champions Final launch skin without API setup", async () => {
  await withExtension(async ({ commands }) => {
    assert.ok(commands.has("soccer:champions"));
    assert.ok(commands.has("soccer:ucl"));
    assert.equal(commands.has("soccer champions"), false);

    const widgets = [];
    const notifications = [];
    const ctx = {
      hasUI: true,
      ui: {
        theme: { fg: (_color, text) => text },
        setWidget: (id, lines) => widgets.push({ id, lines }),
        notify: (text, level = "info") => notifications.push({ text, level }),
      },
    };

    await commands.get("soccer:champions").handler("", ctx);

    const text = widgets.at(-1).lines.join("\n");
    assert.match(text, /Champions Final Night/);
    assert.match(text, /PSG vs Arsenal/);
    assert.match(text, /2026-05-31 01:00 JST/);
    assert.match(text, /Focus mode stays on/);
    assert.doesNotMatch(text, /Prediction/);
    assert.match(text, /not true live/);
    assert.match(text, /\/soccer:worldcup/);
    assert.doesNotMatch(notifications.at(-1).text, /Prediction/);
    assert.match(notifications.at(-1).text, /Data posture: scheduled \/ not true live/);
  });
});

test("/ucl:prediction-ai renders AI provider/model metadata and AI post text", async () => {
  await withExtension(async ({ commands, testing }) => {
    assert.ok(commands.has("ucl:prediction-ai"));
    assert.equal(commands.has("ucl:prediction"), false);
    assert.equal(commands.has("soccer:predict"), false);
    assert.equal(commands.has("soccer:prediction"), false);

    const widgets = [];
    const notifications = [];
    process.env.PI_SOCCER_AI_PROVIDER = "OpenAI";
    process.env.PI_SOCCER_AI_MODEL = "gpt-5.1-codex";
    process.env.PI_SOCCER_AI_ANALYSIS_RESPONSE = '{"method":"custom scouting notes","factors":["pressing edge","set pieces","final volatility"],"lean":"narrow PSG"}';
    process.env.PI_SOCCER_AI_RESPONSE = '{"psg":2,"arsenal":1}';
    const inputs = ["3", "2", "Use my scouting notes"];
    const ctx = {
      hasUI: true,
      ui: {
        theme: { fg: (_color, text) => text },
        setWidget: (id, lines) => widgets.push({ id, lines }),
        notify: (text, level = "info") => notifications.push({ text, level }),
        input: async () => inputs.shift(),
      },
    };

    await commands.get("ucl:prediction-ai").handler("", ctx);

    const text = widgets.map((widget) => widget.lines.join("\n")).join("\n---\n");
    assert.match(text, /Champions AI Prediction/);
    assert.match(text, /You: PSG 3-2 Arsenal \| AI: PSG 2-1 Arsenal/);
    assert.match(text, /AI: OpenAI \/ gpt-5\.1-codex/);
    assert.match(text, /Basis: custom scouting notes \/ pressing edge \/ set pieces \/ final volatility \/ narrow PSG/);
    assert.match(notifications.at(-1).text, /Source posture: active Pi model/);

    const post = testing.championsAiPredictionPostText({
      userPsg: 3,
      userArsenal: 2,
      psg: 2,
      arsenal: 1,
      prompt: "Use my scouting notes",
      provider: "OpenAI",
      model: "gpt-5.1-codex",
      basis: "custom scouting notes / pressing edge / set pieces / final volatility / narrow PSG",
    });
    assert.match(post, /My UCL prediction vs AI/);
    assert.match(post, /Me: PSG 3-2 Arsenal \| AI: PSG 2-1 Arsenal/);
    assert.match(post, /Basis: custom scouting notes \/ pressing edge \/ set pieces \/ final volatility \/ narrow PSG/);
    assert.match(post, /AI: OpenAI \/ gpt-5\.1-codex/);
    assert.match(post, /1 install https:\/\/pi\.dev/);
    assert.match(post, /2 pi install npm:pi-soccer-widget/);
    assert.match(post, /3 \/ucl:prediction-ai/);
    assert.match(post, /No football-data key needed/);
  });
});

test("AI prediction parsing accepts common model output wrappers", async () => {
  await withExtension(async ({ testing }) => {
    assert.deepEqual(testing.parseAiPredictionText('```json\n{"psg":2,"arsenal":1}\n```'), { psg: 2, arsenal: 1 });
    assert.deepEqual(testing.parseAiPredictionText('psg: 1\narsenal: 2'), { psg: 1, arsenal: 2 });
    assert.deepEqual(testing.parseAiPredictionText('PSG 3-2 Arsenal'), { psg: 3, arsenal: 2 });
  });
});

test("/soccer:champions uses football-data CL match data when an API key is configured", async () => {
  const originalFetch = globalThis.fetch;
  try {
    await withExtension(async ({ commands }) => {
      process.env.FOOTBALL_DATA_API_TOKEN = "test-token";
      const requested = [];
      globalThis.fetch = async (url) => {
        requested.push(String(url));
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              matches: [{
                id: 2047742,
                utcDate: "2026-05-30T16:00:00Z",
                status: "IN_PLAY",
                homeTeam: { id: 524, name: "Paris Saint-Germain FC", shortName: "PSG" },
                awayTeam: { id: 57, name: "Arsenal FC", shortName: "Arsenal" },
                score: { winner: null, fullTime: { home: 1, away: 0 } },
                goals: [{ minute: 28, team: { id: 524, name: "Paris Saint-Germain FC" }, scorer: { name: "Dembélé" } }],
              }],
            };
          },
        };
      };

      const widgets = [];
      const notifications = [];
      const ctx = {
        hasUI: true,
        ui: {
          theme: { fg: (_color, text) => text },
          setWidget: (id, lines) => widgets.push({ id, lines }),
          notify: (text, level = "info") => notifications.push({ text, level }),
        },
      };

      await commands.get("soccer:champions").handler("", ctx);

      assert.match(requested[0], /\/competitions\/CL\/matches\?dateFrom=2026-05-30&dateTo=2026-05-31/);
      const text = widgets.at(-1).lines.join("\n");
      assert.match(text, /Champions Final/);
      assert.match(text, /PSG 1-0 Arsenal/);
      assert.match(text, /LIVE/);
      assert.match(text, /Goals: Paris Saint-Germain FC: Dembélé 28'/);
      assert.match(text, /football-data\.org \/ not official live/);
      assert.match(notifications.at(-1).text, /cached \/ not official live/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("/soccer:champions keeps scheduled API skin prediction-free", async () => {
  const originalFetch = globalThis.fetch;
  try {
    await withExtension(async ({ commands }) => {
      process.env.FOOTBALL_DATA_API_TOKEN = "test-token";
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            matches: [{
              id: 2047742,
              utcDate: "2026-05-30T16:00:00Z",
              status: "TIMED",
              homeTeam: { id: 524, name: "Paris Saint-Germain FC", shortName: "PSG" },
              awayTeam: { id: 57, name: "Arsenal FC", shortName: "Arsenal" },
              score: { winner: null, fullTime: { home: null, away: null } },
            }],
          };
        },
      });

      const widgets = [];
      const ctx = {
        hasUI: true,
        ui: {
          theme: { fg: (_color, text) => text },
          setWidget: (id, lines) => widgets.push({ id, lines }),
          notify() {},
        },
      };

      await commands.get("soccer:champions").handler("", ctx);

      const text = widgets.at(-1).lines.join("\n");
      assert.doesNotMatch(text, /Prediction/);
      assert.match(text, /Kickoff: 2026-05-31 01:00 JST/);
      assert.match(text, /football-data\.org \/ not official live/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Champions Final launch skin countdown is deterministic", async () => {
  await withExtension(async ({ testing }) => {
    const beforeKickoff = new Date("2026-05-30T14:30:00.000Z");
    const afterKickoff = new Date("2026-05-30T16:05:00.000Z");

    assert.equal(testing.championsFinalCountdownText(beforeKickoff), "1h 30m to kickoff");
    assert.equal(testing.championsFinalCountdownText(afterKickoff), "kickoff window");
  });
});

test("Champions Final forced window and refresh cadence are bounded", async () => {
  await withExtension(async ({ testing }) => {
    process.env.PI_SOCCER_CHAMPIONS_FORCE = "";
    assert.equal(testing.shouldForceChampionsFinalWidget(new Date("2026-05-30T10:00:00.000Z")), true);
    assert.equal(testing.shouldForceChampionsFinalWidget(new Date("2026-05-30T09:59:59.000Z")), false);
    assert.equal(testing.shouldForceChampionsFinalWidget(new Date("2026-05-30T20:00:00.000Z")), true);
    assert.equal(testing.shouldForceChampionsFinalWidget(new Date("2026-05-30T20:00:01.000Z")), false);

    const base = { timestamp: Date.now(), fetchedAt: Date.now() };
    assert.equal(testing.championsFinalRefreshMs({ ...base, match: null }), 5 * 60 * 1000);
    assert.equal(testing.championsFinalRefreshMs({ ...base, match: { status: "TIMED" } }), 5 * 60 * 1000);
    assert.equal(testing.championsFinalRefreshMs({ ...base, match: { status: "IN_PLAY" } }), 30 * 1000);
    assert.equal(testing.championsFinalRefreshMs({ ...base, match: { status: "PAUSED" } }), 60 * 1000);
    assert.equal(testing.championsFinalRefreshMs({ ...base, match: { status: "FINISHED" } }), 10 * 60 * 1000);
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

