import assert from "node:assert/strict";
import test from "node:test";
import { behaviorAssertions, SDK_NAMES, SDK_VERSION, VERIFICATION_CONTRACT } from "../scripts/pi-sdk-smoke-contract.mjs";

const commandResponse = {
  type: "response",
  command: "get_commands",
  success: true,
  data: { commands: [{ name: "soccer:status" }] },
};
const promptResponse = {
  type: "response",
  command: "prompt",
  success: true,
  data: { disposition: "handled" },
};
const statusNotification = {
  type: "extension_ui_request",
  method: "notify",
  message: "Football-data API key: not configured. Run /soccer:setup.\nSnapshot cache: empty\nDiscovery league: none",
};
const statusResponses = [commandResponse, promptResponse, statusNotification];
const malformedConfigResponses = [
  promptResponse,
  {
    type: "extension_ui_request",
    method: "notify",
    notifyType: "warning",
    message: "No teams in watchlist. Run /soccer:add.",
  },
];

test("the frozen Pi SDK contract names all 1.2.0 packages", () => {
  assert.equal(VERIFICATION_CONTRACT, "pi-sdk-behavior-v2");
  assert.equal(SDK_VERSION, "1.2.0");
  assert.deepEqual(SDK_NAMES, [
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
  ]);
});

test("positive actual-observation fixtures produce the required semantic IDs", () => {
  const load = behaviorAssertions("extension_load", { responses: [commandResponse] });
  const happy = behaviorAssertions("happy_path", { responses: statusResponses });
  const error = behaviorAssertions("error_path", {
    responses: [
      promptResponse,
      {
        type: "extension_ui_request",
        method: "notify",
        notifyType: "warning",
        message: "Missing team name. Use /soccer:search <team-name>.",
      },
    ],
  });
  const malformedConfig = behaviorAssertions("malformed_config", {
    responses: malformedConfigResponses,
  });
  const reload = behaviorAssertions("reload_cleanup", {
    responses: statusResponses,
    fullOutput: "",
    exitCode: 0,
    secondResponses: statusResponses,
    secondOutput: "",
    secondExitCode: 0,
  });
  const shell = behaviorAssertions("host_shell", {
    responses: [],
    fullOutput: `${SDK_VERSION}\n`,
    exitCode: 0,
    expectedVersion: SDK_VERSION,
  });

  assert.deepEqual(load.map(({ id }) => id), ["extension_registered"]);
  assert.deepEqual(happy.map(({ id }) => id), ["feature_response"]);
  assert.deepEqual(error.map(({ id }) => id), ["handled_error"]);
  assert.deepEqual(malformedConfig.map(({ id }) => id), ["malformed_config_recovers"]);
  assert.deepEqual(reload.map(({ id }) => id), [
    "reloaded_extension_registered",
    "reloaded_feature_response",
    "clean_shutdown",
  ]);
  assert.deepEqual(shell.map(({ id }) => id), ["native_shell_boundary"]);
  assert.ok([load, happy, error, malformedConfig, reload, shell].flat().every(({ passed }) => passed));
});

test("missing responses and nonzero reload exits fail closed", () => {
  const missing = [
    behaviorAssertions("extension_load", { responses: [] }),
    behaviorAssertions("happy_path", { responses: [promptResponse] }),
    behaviorAssertions("error_path", { responses: [promptResponse] }),
    behaviorAssertions("malformed_config", { responses: [promptResponse] }),
    behaviorAssertions("reload_cleanup", {
      responses: statusResponses,
      fullOutput: "",
      exitCode: 0,
      secondResponses: [commandResponse],
      secondOutput: "",
      secondExitCode: 1,
    }),
    behaviorAssertions("host_shell", {
      responses: [],
      fullOutput: "not-pi\n",
      exitCode: 0,
      expectedVersion: SDK_VERSION,
    }),
  ];
  assert.ok(missing[0].every(({ passed }) => !passed));
  assert.ok(missing[1].every(({ passed }) => !passed));
  assert.ok(missing[2].every(({ passed }) => !passed));
  assert.ok(missing[3].every(({ passed }) => !passed));
  assert.equal(missing[4][0].passed, true);
  assert.equal(missing[4][1].passed, false);
  assert.equal(missing[4][2].passed, false);
  assert.ok(missing[5].every(({ passed }) => !passed));
});

test("malformed config assertion rejects parse errors and wrong user-facing fallback", () => {
  const results = behaviorAssertions("malformed_config", {
    responses: [
      promptResponse,
      {
        type: "extension_ui_request",
        method: "notify",
        notifyType: "warning",
        message: "Soccer error: Unexpected end of JSON input",
      },
    ],
  });

  assert.equal(results[0].passed, false);
});
