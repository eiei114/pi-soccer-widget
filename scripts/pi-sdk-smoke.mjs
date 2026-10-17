import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  behaviorAssertions,
  EXTENSION_LOAD_ERROR_PATTERN,
  parseJsonLines,
  SDK_NAMES,
  SDK_VERSION,
  UNHANDLED_ERROR_PATTERN,
  VERIFICATION_CONTRACT,
} from "./pi-sdk-smoke-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const reportPath = process.argv.includes("--update-curated-report")
  ? resolve(root, "docs/verification/pi-sdk-smoke.json")
  : resolve(root, ".tmp/pi-sdk-smoke.json");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = readJson(resolve(root, "package.json"));
const sdkVersions = Object.fromEntries(SDK_NAMES.map((name) => [
  name,
  readJson(resolve(root, "node_modules", name, "package.json")).version,
]));

for (const name of SDK_NAMES) {
  if (manifest.devDependencies?.[name] !== sdkVersions[name] || sdkVersions[name] !== SDK_VERSION) {
    throw new Error(`Smoke requires the exact frozen dev/test SDK pin for ${name}: installed ${sdkVersions[name]}`);
  }
}

const piManifest = readJson(resolve(root, "node_modules/@earendil-works/pi-coding-agent/package.json"));
const piCli = resolve(root, "node_modules/@earendil-works/pi-coding-agent", piManifest.bin.pi);
const isolatedRoot = mkdtempSync(resolve(tmpdir(), "pi-soccer-sdk-smoke-"));
const agentDir = resolve(isolatedRoot, "agent");
const homeDir = resolve(isolatedRoot, "home");
mkdirSync(agentDir, { recursive: true });
mkdirSync(homeDir, { recursive: true });

const baseEnv = {
  ...process.env,
  PI_CODING_AGENT_DIR: agentDir,
  HOME: homeDir,
  USERPROFILE: homeDir,
  FOOTBALL_DATA_API_TOKEN: "",
  NO_COLOR: "1",
};
const rpcArgs = [piCli, "--offline", "--no-session", "--no-tools", "--no-extensions", "--no-skills",
  "--no-context-files", "--no-prompt-templates", "--no-mcp", "-e", ".", "--mode", "rpc"];
const commandStream = (prompt) => [
  JSON.stringify({ type: "get_commands" }),
  ...(prompt ? [JSON.stringify({ id: "soccer-smoke", type: "prompt", message: prompt })] : []),
  "",
].join("\n");
const redactCheckout = (output) => output
  .replaceAll(root, "<checkout>")
  .replaceAll(JSON.stringify(root).slice(1, -1), "<checkout>");

function run(name, executable, args, input, env = baseEnv) {
  const result = spawnSync(executable, args, {
    cwd: root,
    env,
    input,
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  const fullOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const exitCode = result.status ?? 1;
  const responses = [...parseJsonLines(result.stdout ?? ""), ...parseJsonLines(result.stderr ?? "")];
  const hasUnhandledError = UNHANDLED_ERROR_PATTERN.test(fullOutput);
  const hasLoadError = EXTENSION_LOAD_ERROR_PATTERN.test(fullOutput);
  return {
    name,
    exit_code: exitCode,
    fullOutput,
    responses,
    hasUnhandledError,
    hasLoadError,
    timedOut: result.error?.code === "ETIMEDOUT",
    error: result.error?.message,
  };
}

function makeCase(name, first, assertions, additional = {}) {
  const fullOutput = [first.fullOutput, additional.second?.fullOutput].filter(Boolean).join("\n--- second Pi process ---\n");
  const hasUnhandledError = first.hasUnhandledError || !!additional.second?.hasUnhandledError;
  const hasLoadError = first.hasLoadError || !!additional.second?.hasLoadError;
  const exitCode = first.exit_code;
  const passed = exitCode === 0
    && (!additional.second || additional.second.exit_code === 0)
    && !first.timedOut && !additional.second?.timedOut
    && !hasUnhandledError && !hasLoadError
    && assertions.every((item) => item.passed);
  return {
    name,
    command: "npm run smoke:pi",
    exit_code: exitCode,
    passed,
    evidence: redactCheckout(fullOutput) || additional.shellOutput || first.error || "No output captured",
    assertions,
    hasUnhandledError,
    hasLoadError,
  };
}

try {
  const loadRun = run("extension_load", process.execPath, rpcArgs, commandStream());
  const loadAssertions = behaviorAssertions("extension_load", {
    responses: loadRun.responses,
    fullOutput: loadRun.fullOutput,
    exitCode: loadRun.exit_code,
  });

  const happyRun = run("happy_path", process.execPath, rpcArgs, commandStream("/soccer:status"));
  const happyAssertions = behaviorAssertions("happy_path", {
    responses: happyRun.responses,
    fullOutput: happyRun.fullOutput,
    exitCode: happyRun.exit_code,
  });

  const errorEnv = { ...baseEnv, FOOTBALL_DATA_API_TOKEN: "pi-sdk-smoke-dummy-token" };
  const errorRun = run("error_path", process.execPath, rpcArgs, commandStream("/soccer:search"), errorEnv);
  const errorAssertions = behaviorAssertions("error_path", {
    responses: errorRun.responses,
    fullOutput: errorRun.fullOutput,
    exitCode: errorRun.exit_code,
  });

  // Two independent real host processes share only the isolated Pi/home directories.
  const reloadFirst = run("reload_cleanup_first", process.execPath, rpcArgs, commandStream("/soccer:status"));
  const reloadSecond = run("reload_cleanup_second", process.execPath, rpcArgs, commandStream("/soccer:status"));
  const reloadAssertions = behaviorAssertions("reload_cleanup", {
    responses: reloadFirst.responses,
    fullOutput: reloadFirst.fullOutput,
    exitCode: reloadFirst.exit_code,
    secondResponses: reloadSecond.responses,
    secondOutput: reloadSecond.fullOutput,
    secondExitCode: reloadSecond.exit_code,
  });

  let hostShell;
  if (process.platform === "win32") {
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    const shell = resolve(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    const script = `& ${quote(process.execPath)} ${quote(piCli)} --version; exit $LASTEXITCODE`;
    hostShell = run("host_shell", shell, ["-NoProfile", "-NonInteractive", "-Command", script], "");
  } else {
    hostShell = run("host_shell", "/bin/sh", ["-c", '"$1" "$2" --version', "pi-host-shell", process.execPath, piCli], "");
  }
  const hostShellOutput = hostShell.fullOutput;
  const hostShellAssertions = behaviorAssertions("host_shell", {
    responses: [],
    fullOutput: hostShellOutput,
    exitCode: hostShell.exit_code,
    expectedVersion: sdkVersions["@earendil-works/pi-coding-agent"],
  });
  const cases = [
    makeCase("extension_load", loadRun, loadAssertions),
    makeCase("happy_path", happyRun, happyAssertions),
    makeCase("error_path", errorRun, errorAssertions),
    makeCase("reload_cleanup", reloadFirst, reloadAssertions, { second: reloadSecond }),
    {
      name: "host_shell",
      command: "npm run smoke:pi",
      exit_code: hostShell.exit_code,
      passed: hostShell.exit_code === 0 && !hostShell.timedOut && !hostShell.hasUnhandledError
        && !hostShell.hasLoadError && hostShellAssertions.every((item) => item.passed),
      evidence: redactCheckout(hostShellOutput) || hostShell.error || "No output captured",
      assertions: hostShellAssertions,
      hasUnhandledError: hostShell.hasUnhandledError,
      hasLoadError: hostShell.hasLoadError,
    },
  ];

  const report = {
    schema_version: 1,
    verification_contract: VERIFICATION_CONTRACT,
    sdk_versions: sdkVersions,
    platform: process.platform,
    model_inference: "none; deterministic soccer extension commands only (actual Pi process and lifecycle are exercised)",
    unhandled_errors: cases.filter((item) => item.hasUnhandledError).length,
    extension_load_errors: cases.filter((item) => item.hasLoadError || (item.name === "extension_load" && !item.passed)).length,
    cases: cases.map(({ hasUnhandledError, hasLoadError, ...item }) => item),
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    verification_contract: VERIFICATION_CONTRACT,
    platform: process.platform,
    cases: cases.map(({ name, passed, exit_code }) => ({ name, passed, exit_code })),
  }));
  if (cases.some((item) => !item.passed)) process.exitCode = 1;
} finally {
  rmSync(isolatedRoot, { recursive: true, force: true });
}
