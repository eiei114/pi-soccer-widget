export const VERIFICATION_CONTRACT = "pi-sdk-behavior-v2";
export const SDK_NAMES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
];

export const UNHANDLED_ERROR_PATTERN = /UnhandledPromiseRejection|uncaught exception|shutdown error/i;
export const EXTENSION_LOAD_ERROR_PATTERN = /Failed to load extension|Error loading extension/i;

export function parseJsonLines(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function assertion(id, expected, observed, passed) {
  return { id, expected, observed: JSON.stringify(observed), passed: passed === true };
}

function commandList(responses) {
  return responses.find((row) => row?.type === "response" && row.command === "get_commands")
    ?.data?.commands;
}

function statusPrompt(responses) {
  return responses.find((row) => row?.type === "response" && row.command === "prompt");
}

function statusNotification(responses, expectedMessage) {
  return responses.find((row) => row?.type === "extension_ui_request"
    && row.method === "notify" && typeof row.message === "string"
    && row.message.startsWith(expectedMessage)
    && row.message.includes("Snapshot cache: empty")
    && row.message.includes("Discovery league: none"));
}

export function behaviorAssertions(name, {
  responses,
  fullOutput,
  exitCode,
  expectedVersion,
  secondResponses = [],
  secondOutput = "",
  secondExitCode = null,
}) {
  const registered = commandList(responses)?.some((command) => command.name === "soccer:status") === true;
  const prompt = statusPrompt(responses);
  const statusMessage = "Football-data API key: not configured. Run /soccer:setup.";
  const notification = statusNotification(responses, statusMessage);
  const handledStatus = prompt?.success === true && prompt.data?.disposition === "handled" && !!notification;

  if (name === "extension_load") {
    const observedCommands = (commandList(responses) ?? [])
      .filter((command) => command.name === "soccer:status")
      .map(({ name: commandName, source }) => ({ name: commandName, source }));
    return [assertion(
      "extension_registered",
      "Pi RPC get_commands includes soccer:status from this extension",
      observedCommands,
      registered,
    )];
  }
  if (name === "happy_path") {
    return [assertion(
      "feature_response",
      "The actual /soccer:status command is handled and notifies that no API key is configured",
      { prompt: prompt ?? null, notification: notification ?? null },
      handledStatus,
    )];
  }
  if (name === "error_path") {
    const errorPrompt = statusPrompt(responses);
    const errorNotification = responses.find((row) => row?.type === "extension_ui_request"
      && row.method === "notify"
      && row.notifyType === "warning"
      && row.message === "Missing team name. Use /soccer:search <team-name>.");
    return [assertion(
      "handled_error",
      "A missing /soccer:search argument is handled with the expected warning",
      { prompt: errorPrompt ?? null, notification: errorNotification ?? null },
      errorPrompt?.success === true && errorPrompt.data?.disposition === "handled" && !!errorNotification,
    )];
  }
  if (name === "reload_cleanup") {
    const reloadedCommands = (commandList(secondResponses) ?? [])
      .filter((command) => command.name === "soccer:status")
      .map(({ name: commandName, source }) => ({ name: commandName, source }));
    const reloadedRegistered = commandList(secondResponses)?.some((command) => command.name === "soccer:status") === true;
    const secondPrompt = statusPrompt(secondResponses);
    const secondNotification = statusNotification(secondResponses, statusMessage);
    const reloadedHandled = secondPrompt?.success === true
      && secondPrompt.data?.disposition === "handled" && !!secondNotification;
    const errors = UNHANDLED_ERROR_PATTERN.test(fullOutput) || UNHANDLED_ERROR_PATTERN.test(secondOutput);
    return [
      assertion(
        "reloaded_extension_registered",
        "A second real Pi process loads the extension and registers soccer:status",
        reloadedCommands,
        reloadedRegistered,
      ),
      assertion(
        "reloaded_feature_response",
        "The second Pi process handles /soccer:status and emits the expected no-key notification",
        { prompt: secondPrompt ?? null, notification: secondNotification ?? null },
        reloadedHandled,
      ),
      assertion(
        "clean_shutdown",
        "Both actual Pi processes exit zero without unhandled or shutdown errors",
        { first_exit_code: exitCode, second_exit_code: secondExitCode, errors },
        exitCode === 0 && secondExitCode === 0 && !errors,
      ),
    ];
  }
  if (name === "host_shell") {
    return [assertion(
      "native_shell_boundary",
      "The native Windows PowerShell shell launches the local pinned Pi CLI and reports its exact version",
      { exit_code: exitCode, output: fullOutput.trim(), expected_version: expectedVersion },
      exitCode === 0 && fullOutput.trim() === expectedVersion,
    )];
  }
  throw new Error(`Unknown smoke case: ${name}`);
}
