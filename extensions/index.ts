/**
 * pi-soccer-widget - Pi coding-agent extension
 *
 * Displays a favorite soccer team, recent result, and next match in a widget
 * above the prompt editor. Supports a watchlist so the widget stays useful
 * when the favorite club is in the off-season.
 *
 * Required env:
 *   FOOTBALL_DATA_API_TOKEN  - api.football-data.org v4 token (free tier ok)
 *
 * Optional env:
 *   PI_SOCCER_TEAM           - default team name, e.g. "Barcelona" (default: "Real Madrid")
 *   PI_SOCCER_COUNTRY        - default World Cup country, e.g. "Japan" or "JPN"
 *   PI_SOCCER_REFRESH_MIN    - refresh interval in minutes (default: 15)
 *   PI_SOCCER_LEAGUES        - comma-separated football-data league codes
 *
 * Commands:
 *   /soccer                  - refresh widget
 *   /soccer:setup            - guided API key + favorite team setup
 *   /soccer:login            - enter and store Football-data API key via Pi UI
 *   /soccer:status           - show API key status without exposing the key
 *   /soccer:sync             - force refresh cached soccer data
 *   /soccer:search <query>   - show candidate teams
 *   /soccer:add <query|n>    - add team to watchlist
 *   /soccer:favorite <query|n> - set favorite team
 *   /soccer:list             - show watchlist
 *   /soccer:remove <query|n> - remove team from watchlist
 *   /soccer:worldcup         - open World Cup menu / followed country setup
 *   /soccer:wc               - alias for /soccer:worldcup
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

const API_BASE = "https://api.football-data.org/v4";
const SIGNUP_URL = "https://www.football-data.org/client/register";
const DOCS_URL = "https://www.football-data.org/documentation/api";
const AGENT_DIR = join(homedir(), ".pi", "agent");
const CONFIG_FILE = join(AGENT_DIR, "pi-soccer-widget-config.json");
const AUTH_FILE = join(AGENT_DIR, "pi-soccer-widget-auth.json");
const LEGACY_TEAM_FILE = join(AGENT_DIR, "soccer-team.json");
const CACHE_FILE = join(AGENT_DIR, "pi-soccer-widget-teams-cache.json");
const LEGACY_CACHE_FILE = join(AGENT_DIR, "soccer-teams-cache.json");
const SEARCH_FILE = join(AGENT_DIR, "pi-soccer-widget-search.json");
const SNAPSHOT_CACHE_FILE = join(AGENT_DIR, "pi-soccer-widget-snapshots.json");
const WIDGET_ID = "pi-soccer-widget";

const DEFAULT_LEAGUES = ["PL", "PD", "SA", "BL1", "FL1", "DED", "PPL"] as const;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SNAPSHOT_TTL_MS = 6 * 60 * 60 * 1000;
const WORLD_CUP_SNAPSHOT_TTL_MS = 60 * 60 * 1000;
const WORLD_CUP_MATCHDAY_TTL_MS = 10 * 60 * 1000;
const WORLD_CUP_REFRESH_MS = 10 * 60 * 1000;
const SYNC_LOCK_MS = 5 * 60 * 1000;
const DISCOVERY_TOP_N = 3;
const WORLD_CUP_CODE = "WC";

const COMMANDS = [
  ["setup", "guided API key + favorite team setup"],
  ["get-key", "show Football-data signup/API key help"],
  ["login", "enter and store Football-data API key via Pi UI"],
  ["status", "show API key and cache status"],
  ["sync", "refresh cached soccer data"],
  ["pick", "search and choose favorite team from a list"],
  ["search", "search team candidates"],
  ["add", "add a team from cached search results"],
  ["favorite", "set favorite team from cached search results"],
  ["list", "show watchlist"],
  ["remove", "remove a watchlist team"],
  ["logout", "remove stored API key"],
] as const;

const COLON_COMMAND_ALIASES = [
  ...COMMANDS.map(([command, description]) => ({ name: `soccer:${command}`, command, description })),
  { name: "soccer:key", command: "get-key", description: "show Football-data signup/API key help" },
  { name: "soccer:api-key", command: "get-key", description: "show Football-data signup/API key help" },
  { name: "soccer:fav", command: "favorite", description: "set favorite team from cached search results" },
  { name: "soccer:rm", command: "remove", description: "remove a watchlist team" },
] as const;

const WORLD_CUP_MENU_ITEMS = [
  "Follow my country",
  "Today's matches",
  "Group table",
  "Match detail",
  "Top scorers",
  "Settings",
] as const;

const WORLD_CUP_COMMAND_ALIASES = [
  { name: "soccer:worldcup", description: "open World Cup menu and followed country setup" },
  { name: "soccer:wc", description: "alias for /soccer:worldcup" },
] as const;

type Notify = (msg: string, level: "info" | "warning" | "error") => void;
type SetWidget = (id: string, lines: string[] | undefined) => void;
type Theme = {
  fg: (color: "accent" | "dim" | "muted" | "success" | "error", text: string) => string;
};

interface TeamRecord {
  teamId: number;
  name: string;
  shortName: string;
  tla: string;
  leagueCode: string;
}

interface WorldCupConfig {
  followedTeamId: number | null;
  teams: TeamRecord[];
  countryCode?: string;
  widgetMode?: "club" | "worldcup";
  updatedAt: string;
}

interface SoccerConfig {
  favoriteTeamId: number | null;
  teams: TeamRecord[];
  lastShownTeamId?: number;
  worldCup?: WorldCupConfig;
  updatedAt: string;
}

interface LegacyTeamConfig {
  team: string;
  teamId: number;
  leagueCode: string;
}

interface TeamsCache {
  [leagueCode: string]: {
    timestamp: number;
    teams: Array<{ id: number; name: string; shortName: string; tla: string }>;
  };
}

interface SearchCache {
  query: string;
  timestamp: number;
  results: TeamRecord[];
}

interface SoccerAuth {
  type: "api_key";
  key: string;
  updatedAt: string;
}

type TokenSource = "environment" | "stored" | "missing";

interface Standing {
  position: number;
  points: number;
  playedGames: number;
}

interface MatchResult {
  utcDate: string;
  homeShort: string;
  awayShort: string;
  homeScore: number | null;
  awayScore: number | null;
  wdl: "W" | "D" | "L";
}

interface NextMatch {
  utcDate: string;
  opponentShort: string;
}

interface TeamSnapshot {
  team: TeamRecord;
  standing: Standing | null;
  lastResult: MatchResult | null;
  nextMatch: NextMatch | null;
  fetchedAt?: number;
  source?: "watchlist" | "discovery";
}

interface SnapshotCache {
  timestamp: number;
  lastSyncStartedAt?: number;
  discoveryLeagueCode?: string;
  discoveryTeamIds: number[];
  snapshots: Record<string, TeamSnapshot>;
  worldCup?: WorldCupSnapshot;
}

interface MatchEntry {
  id?: number;
  utcDate: string;
  status: string;
  stage?: string;
  group?: string | null;
  matchday?: number;
  lastUpdated?: string;
  homeTeam: { id: number; name: string; shortName: string };
  awayTeam: { id: number; name: string; shortName: string };
  score: {
    duration?: string;
    winner: "HOME_TEAM" | "AWAY_TEAM" | "DRAW" | null;
    fullTime: { home: number | null; away: number | null };
    regularTime?: { home: number | null; away: number | null };
    penalties?: { home: number | null; away: number | null };
  };
  goals?: Array<{
    minute?: number | null;
    team?: { id?: number; name?: string };
    scorer?: { name?: string };
  }>;
  bookings?: Array<{
    minute?: number | null;
    team?: { id?: number; name?: string };
    player?: { name?: string };
    card?: string;
  }>;
}

interface StandingTableRow {
  position: number;
  points: number;
  playedGames: number;
  team: { id: number; name: string; shortName?: string; tla?: string };
}

interface WorldCupStandingTable {
  stage?: string;
  type: string;
  group?: string;
  table: StandingTableRow[];
}

interface WorldCupScorerEntry {
  player?: { name?: string; nationality?: string };
  team?: { id?: number; name?: string; shortName?: string; tla?: string };
  goals?: number;
  assists?: number | null;
  penalties?: number | null;
}

interface WorldCupSnapshot {
  timestamp: number;
  fetchedAt: number;
  team: TeamRecord;
  teams: TeamRecord[];
  matches: MatchEntry[];
  standings: WorldCupStandingTable[];
  topScorers: WorldCupScorerEntry[] | null;
  topScorersAvailable: boolean;
}

type NationalTeamSeed = {
  countryCode: string;
  teamId: number;
  name: string;
  shortName: string;
  aliases: string[];
};

const NATIONAL_TEAM_SEEDS: NationalTeamSeed[] = [
  { countryCode: "ARG", teamId: 900001, name: "Argentina", shortName: "Argentina", aliases: ["AR", "Argentina", "Argentine Republic"] },
  { countryCode: "AUS", teamId: 900002, name: "Australia", shortName: "Australia", aliases: ["AU", "Australia", "Socceroos"] },
  { countryCode: "BEL", teamId: 900003, name: "Belgium", shortName: "Belgium", aliases: ["BE", "Belgium"] },
  { countryCode: "BRA", teamId: 900004, name: "Brazil", shortName: "Brazil", aliases: ["BR", "Brazil", "Brasil"] },
  { countryCode: "CAN", teamId: 900005, name: "Canada", shortName: "Canada", aliases: ["CA", "Canada"] },
  { countryCode: "CHI", teamId: 900006, name: "Chile", shortName: "Chile", aliases: ["CL", "Chile"] },
  { countryCode: "COL", teamId: 900007, name: "Colombia", shortName: "Colombia", aliases: ["CO", "Colombia"] },
  { countryCode: "CRO", teamId: 900008, name: "Croatia", shortName: "Croatia", aliases: ["HR", "Croatia", "Hrvatska"] },
  { countryCode: "DEN", teamId: 900009, name: "Denmark", shortName: "Denmark", aliases: ["DK", "Denmark"] },
  { countryCode: "ECU", teamId: 900010, name: "Ecuador", shortName: "Ecuador", aliases: ["EC", "Ecuador"] },
  { countryCode: "ENG", teamId: 900011, name: "England", shortName: "England", aliases: ["GB", "UK", "United Kingdom", "England"] },
  { countryCode: "FRA", teamId: 900012, name: "France", shortName: "France", aliases: ["FR", "France"] },
  { countryCode: "GER", teamId: 900013, name: "Germany", shortName: "Germany", aliases: ["DE", "Germany", "Deutschland"] },
  { countryCode: "GHA", teamId: 900014, name: "Ghana", shortName: "Ghana", aliases: ["GH", "Ghana"] },
  { countryCode: "IRN", teamId: 900015, name: "Iran", shortName: "Iran", aliases: ["IR", "Iran", "Islamic Republic of Iran"] },
  { countryCode: "ITA", teamId: 900016, name: "Italy", shortName: "Italy", aliases: ["IT", "Italy", "Italia"] },
  { countryCode: "JPN", teamId: 900017, name: "Japan", shortName: "Japan", aliases: ["JP", "Japan", "Nippon", "Nihon", "日本"] },
  { countryCode: "KOR", teamId: 900018, name: "South Korea", shortName: "South Korea", aliases: ["KR", "Korea", "South Korea", "Republic of Korea"] },
  { countryCode: "MAR", teamId: 900019, name: "Morocco", shortName: "Morocco", aliases: ["MA", "Morocco"] },
  { countryCode: "MEX", teamId: 900020, name: "Mexico", shortName: "Mexico", aliases: ["MX", "Mexico", "México"] },
  { countryCode: "NED", teamId: 900021, name: "Netherlands", shortName: "Netherlands", aliases: ["NL", "Netherlands", "Holland"] },
  { countryCode: "NZL", teamId: 900022, name: "New Zealand", shortName: "New Zealand", aliases: ["NZ", "New Zealand"] },
  { countryCode: "POL", teamId: 900023, name: "Poland", shortName: "Poland", aliases: ["PL", "Poland", "Polska"] },
  { countryCode: "POR", teamId: 900024, name: "Portugal", shortName: "Portugal", aliases: ["PT", "Portugal"] },
  { countryCode: "QAT", teamId: 900025, name: "Qatar", shortName: "Qatar", aliases: ["QA", "Qatar"] },
  { countryCode: "KSA", teamId: 900026, name: "Saudi Arabia", shortName: "Saudi Arabia", aliases: ["SA", "Saudi Arabia", "Saudi"] },
  { countryCode: "SEN", teamId: 900027, name: "Senegal", shortName: "Senegal", aliases: ["SN", "Senegal"] },
  { countryCode: "SRB", teamId: 900028, name: "Serbia", shortName: "Serbia", aliases: ["RS", "Serbia"] },
  { countryCode: "ESP", teamId: 900029, name: "Spain", shortName: "Spain", aliases: ["ES", "Spain", "España"] },
  { countryCode: "SUI", teamId: 900030, name: "Switzerland", shortName: "Switzerland", aliases: ["CH", "Switzerland", "Suisse", "Schweiz"] },
  { countryCode: "TUN", teamId: 900031, name: "Tunisia", shortName: "Tunisia", aliases: ["TN", "Tunisia"] },
  { countryCode: "URU", teamId: 900032, name: "Uruguay", shortName: "Uruguay", aliases: ["UY", "Uruguay"] },
  { countryCode: "USA", teamId: 900033, name: "United States", shortName: "United States", aliases: ["US", "USA", "United States", "United States of America", "America"] },
  { countryCode: "WAL", teamId: 900034, name: "Wales", shortName: "Wales", aliases: ["Wales", "Cymru"] },
];

const NATIONAL_TEAMS: TeamRecord[] = NATIONAL_TEAM_SEEDS.map((seed) => ({
  teamId: seed.teamId,
  name: seed.name,
  shortName: seed.shortName,
  tla: seed.countryCode,
  leagueCode: "WC",
}));

const LOCALE_REGION_TO_WORLD_CUP_CODE: Record<string, string> = Object.fromEntries(
  NATIONAL_TEAM_SEEDS.flatMap((seed) => seed.aliases.filter((alias) => /^[A-Z]{2}$/.test(alias)).map((alias) => [alias, seed.countryCode])),
);

const TIME_ZONE_TO_WORLD_CUP_CODE: Record<string, string> = {
  "America/Argentina/Buenos_Aires": "ARG",
  "America/Bogota": "COL",
  "America/Denver": "USA",
  "America/Los_Angeles": "USA",
  "America/Mexico_City": "MEX",
  "America/New_York": "USA",
  "America/Santiago": "CHI",
  "America/Sao_Paulo": "BRA",
  "America/Toronto": "CAN",
  "Asia/Riyadh": "KSA",
  "Asia/Seoul": "KOR",
  "Asia/Tehran": "IRN",
  "Asia/Tokyo": "JPN",
  "Australia/Sydney": "AUS",
  "Europe/Amsterdam": "NED",
  "Europe/Belgrade": "SRB",
  "Europe/Berlin": "GER",
  "Europe/Brussels": "BEL",
  "Europe/Copenhagen": "DEN",
  "Europe/Lisbon": "POR",
  "Europe/London": "ENG",
  "Europe/Madrid": "ESP",
  "Europe/Paris": "FRA",
  "Europe/Rome": "ITA",
  "Europe/Warsaw": "POL",
  "Europe/Zagreb": "CRO",
};

let currentConfig: SoccerConfig | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function clearRefreshTimer(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function isStaleContextError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("This extension ctx is stale");
}

function ensureAgentDir(): void {
  try {
    mkdirSync(AGENT_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

function readJson<T>(file: string): T | null {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  ensureAgentDir();
  try {
    writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
    try {
      chmodSync(file, 0o600);
    } catch {
      // ignore chmod errors on platforms that do not support POSIX modes
    }
  } catch {
    // ignore
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function ageText(timestamp?: number): string {
  if (!timestamp) return "never";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function uniqueTeams(teams: TeamRecord[]): TeamRecord[] {
  const seen = new Set<number>();
  return teams.filter((team) => {
    if (seen.has(team.teamId)) return false;
    seen.add(team.teamId);
    return true;
  });
}

function normalizeWorldCupConfig(value?: WorldCupConfig): WorldCupConfig | undefined {
  if (!value || !Array.isArray(value.teams)) return undefined;
  const teams = uniqueTeams(value.teams).map((team) => ({ ...team, leagueCode: WORLD_CUP_CODE }));
  const followedTeamId = value.followedTeamId ?? teams[0]?.teamId ?? null;
  return {
    followedTeamId,
    teams,
    countryCode: value.countryCode ?? teams.find((team) => team.teamId === followedTeamId)?.tla,
    widgetMode: value.widgetMode === "worldcup" ? "worldcup" : value.widgetMode === "club" ? "club" : undefined,
    updatedAt: value.updatedAt ?? nowIso(),
  };
}

function readConfig(): SoccerConfig {
  const existing = readJson<SoccerConfig>(CONFIG_FILE);
  if (existing && Array.isArray(existing.teams)) {
    return {
      favoriteTeamId: existing.favoriteTeamId ?? existing.teams[0]?.teamId ?? null,
      teams: uniqueTeams(existing.teams),
      lastShownTeamId: existing.lastShownTeamId,
      worldCup: normalizeWorldCupConfig(existing.worldCup),
      updatedAt: existing.updatedAt ?? nowIso(),
    };
  }

  const legacy = readJson<LegacyTeamConfig>(LEGACY_TEAM_FILE);
  if (legacy?.teamId) {
    const team: TeamRecord = {
      teamId: legacy.teamId,
      name: legacy.team,
      shortName: legacy.team,
      tla: "",
      leagueCode: legacy.leagueCode,
    };
    const migrated: SoccerConfig = {
      favoriteTeamId: team.teamId,
      teams: [team],
      updatedAt: nowIso(),
    };
    writeConfig(migrated);
    return migrated;
  }

  return { favoriteTeamId: null, teams: [], updatedAt: nowIso() };
}

function writeConfig(config: SoccerConfig): void {
  const worldCup = normalizeWorldCupConfig(config.worldCup);
  currentConfig = {
    ...config,
    teams: uniqueTeams(config.teams),
    ...(worldCup ? { worldCup: { ...worldCup, updatedAt: nowIso() } } : { worldCup: undefined }),
    updatedAt: nowIso(),
  };
  writeJson(CONFIG_FILE, currentConfig);
}

function readTeamsCache(): TeamsCache {
  return readJson<TeamsCache>(CACHE_FILE) ?? readJson<TeamsCache>(LEGACY_CACHE_FILE) ?? {};
}

function writeTeamsCache(cache: TeamsCache): void {
  writeJson(CACHE_FILE, cache);
}

function readSearchCache(): SearchCache | null {
  return readJson<SearchCache>(SEARCH_FILE);
}

function writeSearchCache(query: string, results: TeamRecord[]): void {
  writeJson(SEARCH_FILE, { query, timestamp: Date.now(), results } satisfies SearchCache);
}

function emptySnapshotCache(): SnapshotCache {
  return { timestamp: 0, discoveryTeamIds: [], snapshots: {} };
}

function readSnapshotCache(): SnapshotCache {
  const cache = readJson<SnapshotCache>(SNAPSHOT_CACHE_FILE) ?? emptySnapshotCache();
  return {
    ...emptySnapshotCache(),
    ...cache,
    snapshots: cache.snapshots ?? {},
    discoveryTeamIds: cache.discoveryTeamIds ?? [],
  };
}

function writeSnapshotCache(cache: SnapshotCache): void {
  writeJson(SNAPSHOT_CACHE_FILE, cache);
}

function readStoredToken(): string | undefined {
  const auth = readJson<SoccerAuth>(AUTH_FILE);
  return auth?.type === "api_key" && auth.key ? auth.key : undefined;
}

function resolveApiToken(): { token?: string; source: TokenSource } {
  const envToken = process.env.FOOTBALL_DATA_API_TOKEN;
  if (envToken) return { token: envToken, source: "environment" };
  const storedToken = readStoredToken();
  if (storedToken) return { token: storedToken, source: "stored" };
  return { source: "missing" };
}

function writeStoredToken(token: string): void {
  writeJson(AUTH_FILE, { type: "api_key", key: token, updatedAt: nowIso() } satisfies SoccerAuth);
}

function removeStoredToken(): void {
  try {
    if (existsSync(AUTH_FILE)) rmSync(AUTH_FILE);
  } catch {
    // ignore
  }
}

function authStatusText(): string {
  const { source } = resolveApiToken();
  const cache = readSnapshotCache();
  const auth = source === "environment"
    ? "Football-data API key: configured via FOOTBALL_DATA_API_TOKEN environment variable."
    : source === "stored"
    ? "Football-data API key: configured via pi-soccer-widget login."
    : "Football-data API key: not configured. Run /soccer:setup.";
  return `${auth}\nSnapshot cache: ${cache.timestamp ? ageText(cache.timestamp) : "empty"}\nDiscovery league: ${cache.discoveryLeagueCode ?? "none"}`;
}

function leagueCodes(): string[] {
  const raw = process.env.PI_SOCCER_LEAGUES;
  if (!raw) return [...DEFAULT_LEAGUES];
  const parsed = raw.split(",").map((part) => part.trim().toUpperCase()).filter(Boolean);
  return parsed.length > 0 ? parsed : [...DEFAULT_LEAGUES];
}

async function apiFetch(path: string, token: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { "X-Auth-Token": token },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeName(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length];
}

function fuzzyScore(query: string, name: string): number {
  const q = normalizeName(query);
  const candidate = normalizeName(name);
  if (!q || !candidate) return 0;
  if (candidate === q) return 120;
  if (candidate.startsWith(q)) return 100;
  if (candidate.includes(q)) return 80;

  const words = candidate.split(" ").filter(Boolean);
  if (q.length >= 4 && words.some((part) => part.startsWith(q))) return 70;
  if (q.length < 4) return 0;

  const queryWordCount = q.split(" ").filter(Boolean).length;
  const windows: string[] = [];
  if (queryWordCount > 1 && words.length >= queryWordCount) {
    for (let index = 0; index <= words.length - queryWordCount; index += 1) {
      windows.push(words.slice(index, index + queryWordCount).join(" "));
    }
  }
  const variants = [candidate, ...windows, ...words.filter((part) => part.length >= 4)];
  return variants.reduce((best, variant) => {
    const longest = Math.max(q.length, variant.length);
    const distance = editDistance(q, variant);
    const similarity = 1 - distance / longest;
    if (distance <= 1 && q.length >= 4) return Math.max(best, 65);
    if (distance <= 2 && q.length >= 6 && similarity >= 0.72) return Math.max(best, 58);
    if (distance <= 3 && q.length >= 10 && similarity >= 0.78) return Math.max(best, 52);
    return best;
  }, 0);
}

function scoreTeamMatch(query: string, team: TeamRecord): number {
  const aliases = [team.name, team.shortName, team.tla].filter(Boolean);
  return Math.max(0, ...aliases.map((alias) => fuzzyScore(query, alias)));
}

function shortTeamName(t: { name: string; shortName: string }): string {
  return t.shortName?.trim() || t.name;
}

function teamLabel(team: TeamRecord): string {
  const tla = team.tla ? ` | ${team.tla}` : "";
  return `${team.shortName || team.name} | ${team.leagueCode}${tla}`;
}

function nationalTeamLabel(team: TeamRecord): string {
  return `${team.name} | ${team.tla} | ${team.leagueCode}`;
}

function nationalSeedForTeam(team: TeamRecord): NationalTeamSeed | undefined {
  return NATIONAL_TEAM_SEEDS.find((seed) => seed.teamId === team.teamId || seed.countryCode === team.tla);
}

function nationalTeamByCountryCode(code: string): TeamRecord | undefined {
  const normalized = code.trim().toUpperCase();
  const seed = NATIONAL_TEAM_SEEDS.find((item) => item.countryCode === normalized);
  return seed ? NATIONAL_TEAMS.find((team) => team.teamId === seed.teamId) : undefined;
}

function findNationalTeams(query: string): TeamRecord[] {
  const raw = String(query ?? "").trim();
  if (!raw) return [];
  const upper = raw.toUpperCase();
  const normalized = normalizeName(raw);

  const scored = NATIONAL_TEAM_SEEDS.map((seed) => {
    const team = NATIONAL_TEAMS.find((item) => item.teamId === seed.teamId)!;
    const aliasScores = seed.aliases.map((alias) => {
      if (alias.toUpperCase() === upper) return 130;
      return fuzzyScore(normalized, alias);
    });
    const score = Math.max(
      seed.countryCode === upper ? 140 : 0,
      scoreTeamMatch(normalized, team),
      ...aliasScores,
    );
    return { team, score };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.team.name.localeCompare(b.team.name))
    .slice(0, 8)
    .map((item) => item.team);
}

function followedWorldCupTeam(config: SoccerConfig): TeamRecord | null {
  const worldCup = normalizeWorldCupConfig(config.worldCup);
  if (!worldCup) return null;
  return worldCup.teams.find((team) => team.teamId === worldCup.followedTeamId) ?? worldCup.teams[0] ?? null;
}

function setFollowedWorldCupTeam(config: SoccerConfig, team: TeamRecord): SoccerConfig {
  const wcTeam = { ...team, leagueCode: WORLD_CUP_CODE };
  const existing = normalizeWorldCupConfig(config.worldCup);
  return {
    ...config,
    worldCup: {
      followedTeamId: wcTeam.teamId,
      teams: uniqueTeams([...(existing?.teams ?? []), wcTeam]),
      countryCode: nationalSeedForTeam(wcTeam)?.countryCode ?? wcTeam.tla,
      widgetMode: existing?.widgetMode,
      updatedAt: nowIso(),
    },
  };
}

function shouldUseWorldCupWidget(config: SoccerConfig): boolean {
  const worldCup = normalizeWorldCupConfig(config.worldCup);
  if (!worldCup || !followedWorldCupTeam(config)) return false;
  if (worldCup.widgetMode) return worldCup.widgetMode === "worldcup";
  return config.teams.length === 0;
}

function setWorldCupWidgetMode(config: SoccerConfig, mode: "club" | "worldcup"): SoccerConfig {
  const worldCup = normalizeWorldCupConfig(config.worldCup);
  if (!worldCup) return config;
  return { ...config, worldCup: { ...worldCup, widgetMode: mode, updatedAt: nowIso() } };
}

function sameWorldCupTeam(apiTeam: { id?: number; name?: string; shortName?: string; tla?: string }, followed: TeamRecord): boolean {
  if (apiTeam.id && apiTeam.id === followed.teamId) return true;
  const followedSeed = nationalSeedForTeam(followed);
  const followedCodes = [followed.tla, followedSeed?.countryCode].filter(Boolean).map((item) => item!.toUpperCase());
  if (apiTeam.tla && followedCodes.includes(apiTeam.tla.toUpperCase())) return true;
  const names = [apiTeam.name, apiTeam.shortName].filter(Boolean).map((item) => normalizeName(item!));
  const followedNames = [followed.name, followed.shortName, ...(followedSeed?.aliases ?? [])].filter(Boolean).map((item) => normalizeName(item));
  return names.some((name) => followedNames.includes(name));
}

function worldCupTeamFromApi(team: { id: number; name: string; shortName?: string; tla?: string }): TeamRecord {
  return {
    teamId: team.id,
    name: team.name,
    shortName: team.shortName || team.name,
    tla: team.tla || "",
    leagueCode: WORLD_CUP_CODE,
  };
}

function resolveWorldCupTeam(followed: TeamRecord, teams: TeamRecord[]): TeamRecord {
  return teams.find((team) => sameWorldCupTeam({ id: team.teamId, name: team.name, shortName: team.shortName, tla: team.tla }, followed)) ?? followed;
}

function matchIncludesTeam(match: MatchEntry, team: TeamRecord): boolean {
  return sameWorldCupTeam(match.homeTeam, team) || sameWorldCupTeam(match.awayTeam, team);
}

function activeMatch(match: MatchEntry): boolean {
  return ["IN_PLAY", "PAUSED", "LIVE"].includes(match.status);
}

function scheduledMatch(match: MatchEntry): boolean {
  return ["SCHEDULED", "TIMED"].includes(match.status);
}

function finishedMatch(match: MatchEntry): boolean {
  return match.status === "FINISHED";
}

function todayMatch(match: MatchEntry): boolean {
  return match.utcDate.slice(0, 10) === todayStr();
}

function scorePair(match: MatchEntry): { home: number | null; away: number | null } {
  return match.score.fullTime ?? match.score.regularTime ?? { home: null, away: null };
}

function hasPenaltyScore(match: MatchEntry): boolean {
  const penalties = match.score.penalties;
  return penalties?.home != null || penalties?.away != null || match.score.duration === "PENALTY_SHOOTOUT";
}

function matchStatusText(match: MatchEntry): string {
  if (activeMatch(match)) return match.status === "PAUSED" ? "HT" : "LIVE";
  if (finishedMatch(match)) return hasPenaltyScore(match) ? "FT pens" : "FT";
  if (scheduledMatch(match)) return fmtLocalDateTime(match.utcDate);
  return match.status.replace(/_/g, " ").toLowerCase();
}

function matchLine(match: MatchEntry): string {
  const score = scorePair(match);
  const home = shortTeamName(match.homeTeam);
  const away = shortTeamName(match.awayTeam);
  const middle = score.home == null || score.away == null ? "vs" : `${score.home}-${score.away}`;
  const group = match.group ? ` | ${match.group}` : "";
  return `${home} ${middle} ${away} | ${matchStatusText(match)}${group}`;
}

function chooseWorldCupMatch(matches: MatchEntry[], followed: TeamRecord): MatchEntry | null {
  const followedMatches = matches.filter((match) => matchIncludesTeam(match, followed));
  const active = followedMatches.filter(activeMatch).sort((a, b) => a.utcDate.localeCompare(b.utcDate))[0];
  if (active) return active;
  const next = followedMatches.filter(scheduledMatch).sort((a, b) => a.utcDate.localeCompare(b.utcDate))[0];
  if (next) return next;
  return followedMatches.filter(finishedMatch).sort((a, b) => b.utcDate.localeCompare(a.utcDate))[0] ?? null;
}

function findWorldCupStanding(snapshot: WorldCupSnapshot): { group?: string; row: StandingTableRow; table: StandingTableRow[] } | null {
  for (const standing of snapshot.standings) {
    if (standing.type !== "TOTAL") continue;
    const row = standing.table.find((item) => sameWorldCupTeam(item.team, snapshot.team));
    if (row) return { group: standing.group, row, table: standing.table };
  }
  return null;
}

function worldCupGoalsLine(match: MatchEntry | null, followed?: TeamRecord): string | null {
  const goals = (match?.goals ?? [])
    .filter((goal) => goal.scorer?.name)
    .slice(0, 4)
    .map((goal) => {
      const teamMark = followed && goal.team && sameWorldCupTeam(goal.team, followed) ? "" : goal.team?.name ? `${goal.team.name}: ` : "";
      const minute = goal.minute ? ` ${goal.minute}'` : "";
      return `${teamMark}${goal.scorer!.name}${minute}`;
    });
  return goals.length ? `Goals: ${goals.join(", ")}` : null;
}

function worldCupFlagsLine(match: MatchEntry | null): string | null {
  if (!match) return null;
  const flags: string[] = [];
  const redCards = (match.bookings ?? []).filter((booking) => booking.card === "RED_CARD" || booking.card === "SECOND_YELLOW");
  if (redCards.length) flags.push(`${redCards.length} red card${redCards.length > 1 ? "s" : ""}`);
  if (hasPenaltyScore(match)) {
    const p = match.score.penalties;
    flags.push(p?.home != null && p?.away != null ? `pens ${p.home}-${p.away}` : "penalty shootout");
  }
  return flags.length ? `Notes: ${flags.join(" | ")}` : null;
}

function worldCupCacheFresh(snapshot: WorldCupSnapshot): boolean {
  const matchday = snapshot.matches.some((match) => todayMatch(match) || activeMatch(match));
  const ttl = matchday ? WORLD_CUP_MATCHDAY_TTL_MS : WORLD_CUP_SNAPSHOT_TTL_MS;
  return Date.now() - snapshot.timestamp < ttl;
}

async function fetchWorldCupTeams(token: string): Promise<TeamRecord[]> {
  const data = (await apiFetch(`/competitions/${WORLD_CUP_CODE}/teams`, token)) as {
    teams?: Array<{ id: number; name: string; shortName?: string; tla?: string }>;
  };
  return (data.teams ?? []).map(worldCupTeamFromApi);
}

async function fetchWorldCupMatches(token: string): Promise<MatchEntry[]> {
  const data = (await apiFetch(`/competitions/${WORLD_CUP_CODE}/matches?dateFrom=${offsetDateStr(-7)}&dateTo=${offsetDateStr(30)}`, token)) as { matches?: MatchEntry[] };
  return data.matches ?? [];
}

async function fetchWorldCupStandings(token: string): Promise<WorldCupStandingTable[]> {
  const data = (await apiFetch(`/competitions/${WORLD_CUP_CODE}/standings`, token)) as { standings?: WorldCupStandingTable[] };
  return data.standings ?? [];
}

async function fetchWorldCupTopScorers(token: string): Promise<WorldCupScorerEntry[] | null> {
  try {
    const data = (await apiFetch(`/competitions/${WORLD_CUP_CODE}/scorers?limit=10`, token)) as { scorers?: WorldCupScorerEntry[] };
    return data.scorers ?? [];
  } catch {
    return null;
  }
}

async function fetchWorldCupMatchDetail(matchId: number, token: string): Promise<MatchEntry | null> {
  try {
    const data = (await apiFetch(`/matches/${matchId}`, token)) as { match?: MatchEntry } & MatchEntry;
    return data.match ?? data;
  } catch {
    return null;
  }
}

async function syncWorldCupData(config: SoccerConfig, token: string, options?: { force?: boolean }): Promise<WorldCupSnapshot> {
  const followed = followedWorldCupTeam(config);
  if (!followed) throw new Error("World Cup country is not set.");
  const cache = readSnapshotCache();
  if (!options?.force && cache.worldCup && sameWorldCupTeam(cache.worldCup.team, followed) && worldCupCacheFresh(cache.worldCup)) {
    return cache.worldCup;
  }

  const [teamsResult, matchesResult, standingsResult, scorersResult] = await Promise.allSettled([
    fetchWorldCupTeams(token),
    fetchWorldCupMatches(token),
    fetchWorldCupStandings(token),
    fetchWorldCupTopScorers(token),
  ]);

  const teams = teamsResult.status === "fulfilled" && teamsResult.value.length ? teamsResult.value : NATIONAL_TEAMS;
  const team = resolveWorldCupTeam(followed, teams);
  const matches = matchesResult.status === "fulfilled" ? matchesResult.value : cache.worldCup?.matches ?? [];
  const standings = standingsResult.status === "fulfilled" ? standingsResult.value : cache.worldCup?.standings ?? [];
  const topScorers = scorersResult.status === "fulfilled" ? scorersResult.value : null;
  const topScorersAvailable = Array.isArray(topScorers);

  if (matchesResult.status === "rejected" && standingsResult.status === "rejected" && teamsResult.status === "rejected" && cache.worldCup) {
    return cache.worldCup;
  }

  const snapshot: WorldCupSnapshot = {
    timestamp: Date.now(),
    fetchedAt: Date.now(),
    team,
    teams,
    matches,
    standings,
    topScorers,
    topScorersAvailable,
  };
  writeSnapshotCache({ ...cache, worldCup: snapshot });
  return snapshot;
}

function renderWorldCupSnapshot(snapshot: WorldCupSnapshot, theme: Theme): string[] {
  const match = chooseWorldCupMatch(snapshot.matches, snapshot.team);
  const standing = findWorldCupStanding(snapshot);
  const lines: string[] = [];
  const teamPart = theme.fg("accent", snapshot.team.shortName || snapshot.team.name);
  const cacheHint = theme.fg("dim", `cache ${ageText(snapshot.fetchedAt)} | sync ~${snapshot.matches.some((item) => todayMatch(item) || activeMatch(item)) ? "10m" : "60m"}`);
  lines.push(`World Cup: ${teamPart}${standing ? theme.fg("dim", ` | ${standing.group ?? "group"} #${standing.row.position} | ${standing.row.points}pts`) : ""} | ${cacheHint}`);

  if (match) {
    lines.push(matchLine(match));
    const goals = worldCupGoalsLine(match, snapshot.team);
    if (goals) lines.push(goals);
    const standingLine = standing ? `Group: #${standing.row.position}, ${standing.row.points}pts/${standing.row.playedGames} played${standing.group ? ` | ${standing.group}` : ""}` : null;
    const flags = worldCupFlagsLine(match);
    if (flags) lines.push(flags);
    if (standingLine && lines.length < 5) lines.push(theme.fg("dim", standingLine));
    if (!activeMatch(match) && lines.length < 5) {
      const todays = snapshot.matches.filter(todayMatch).sort((a, b) => a.utcDate.localeCompare(b.utcDate)).slice(0, 2);
      if (todays.length) lines.push(`Today: ${todays.map(matchLine).join("; ")}`);
    }
  } else {
    lines.push(theme.fg("dim", "Followed country: no match in current window"));
    const todays = snapshot.matches.filter(todayMatch).sort((a, b) => a.utcDate.localeCompare(b.utcDate)).slice(0, 2);
    if (todays.length) lines.push(`Today: ${todays.map(matchLine).join("; ")}`);
    if (standing) lines.push(theme.fg("dim", `Group: #${standing.row.position}, ${standing.row.points}pts/${standing.row.playedGames} played${standing.group ? ` | ${standing.group}` : ""}`));
  }

  return lines.slice(0, 5);
}

async function refreshWorldCupWidget(setWidget: SetWidget, theme: Theme, config: SoccerConfig, options?: { forceSync?: boolean }): Promise<void> {
  const { token } = resolveApiToken();
  if (!token) {
    setWidget(WIDGET_ID, renderNoToken(theme));
    return;
  }
  const followed = followedWorldCupTeam(config);
  if (!followed) {
    setWidget(WIDGET_ID, [theme.fg("dim", "World Cup: no followed country yet. Run /soccer:worldcup")]);
    return;
  }
  setWidget(WIDGET_ID, [theme.fg("dim", `World Cup: ${followed.shortName || followed.name} Loading...`)]);
  try {
    const snapshot = await syncWorldCupData(config, token, { force: options?.forceSync });
    setWidget(WIDGET_ID, renderWorldCupSnapshot(snapshot, theme));
  } catch (err) {
    const stale = readSnapshotCache().worldCup;
    if (stale) {
      setWidget(WIDGET_ID, renderWorldCupSnapshot(stale, theme));
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    setWidget(WIDGET_ID, renderError(msg, theme));
  }
}

function formatWorldCupToday(snapshot: WorldCupSnapshot): string {
  const matches = snapshot.matches.filter(todayMatch).sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  if (!matches.length) return "World Cup today: no matches found.";
  return `World Cup today:\n${matches.slice(0, 8).map((match) => `- ${matchLine(match)}`).join("\n")}`;
}

function formatWorldCupGroup(snapshot: WorldCupSnapshot): string {
  const standing = findWorldCupStanding(snapshot);
  if (!standing) return "World Cup group table: not available.";
  const rows = standing.table
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((row) => `${row.position}. ${row.team.shortName || row.team.name} ${row.points}pts (${row.playedGames} played)`);
  return `World Cup ${standing.group ?? "group"}:\n${rows.join("\n")}`;
}

function formatWorldCupTopScorers(snapshot: WorldCupSnapshot): string {
  if (!snapshot.topScorersAvailable || !snapshot.topScorers?.length) return "World Cup top scorers: not available.";
  const rows = snapshot.topScorers.slice(0, 10).map((entry, index) => {
    const name = entry.player?.name ?? "Unknown player";
    const team = entry.team?.shortName ?? entry.team?.name ?? entry.player?.nationality ?? "";
    return `${index + 1}. ${name}${team ? ` (${team})` : ""} - ${entry.goals ?? 0}`;
  });
  return `World Cup top scorers:\n${rows.join("\n")}`;
}

function formatWorldCupMatchDetail(match: MatchEntry | null, snapshot: WorldCupSnapshot): string {
  if (!match) return "World Cup match detail: not available.";
  const lines = [`World Cup match detail:`, matchLine(match)];
  if (match.stage || match.group || match.matchday) {
    lines.push([match.stage, match.group, match.matchday ? `matchday ${match.matchday}` : undefined].filter(Boolean).join(" | "));
  }
  const goals = worldCupGoalsLine(match, snapshot.team);
  if (goals) lines.push(goals);
  const flags = worldCupFlagsLine(match);
  if (flags) lines.push(flags);
  if (match.lastUpdated) lines.push(`Updated: ${fmtLocalDateTime(match.lastUpdated)}`);
  return lines.join("\n");
}

function localeRegion(locale?: string): string | undefined {
  if (!locale) return undefined;
  const match = locale.replace("_", "-").match(/-([A-Za-z]{2})(?:-|$)/);
  return match?.[1]?.toUpperCase();
}

function resolveLocale(): string | undefined {
  return process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale;
}

function resolveTimeZone(): string | undefined {
  return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function guessWorldCupCountryFromConfiguredEnv(): { team: TeamRecord; source: string } | null {
  const raw = String(process.env.PI_SOCCER_COUNTRY ?? "").trim();
  if (!raw) return null;
  const team = findNationalTeams(raw)[0];
  return team ? { team, source: "PI_SOCCER_COUNTRY" } : null;
}

function guessWorldCupCountryFromLocaleTimezone(): { team: TeamRecord; source: string } | null {
  const region = localeRegion(resolveLocale());
  const countryCode = region ? LOCALE_REGION_TO_WORLD_CUP_CODE[region] : undefined;
  const localeTeam = countryCode ? nationalTeamByCountryCode(countryCode) : undefined;
  if (localeTeam) return { team: localeTeam, source: "locale" };

  const timeZone = resolveTimeZone();
  const timeZoneCode = timeZone ? TIME_ZONE_TO_WORLD_CUP_CODE[timeZone] : undefined;
  const timeZoneTeam = timeZoneCode ? nationalTeamByCountryCode(timeZoneCode) : undefined;
  return timeZoneTeam ? { team: timeZoneTeam, source: "timezone" } : null;
}

async function loadLeagueTeams(code: string, token: string): Promise<TeamRecord[]> {
  const cache = readTeamsCache();
  const now = Date.now();
  let roster = cache[code];
  if (!roster || now - roster.timestamp > CACHE_TTL_MS) {
    const data = (await apiFetch(`/competitions/${code}/teams`, token)) as {
      teams: Array<{ id: number; name: string; shortName: string; tla: string }>;
    };
    roster = { timestamp: now, teams: data.teams };
    cache[code] = roster;
    writeTeamsCache(cache);
  }
  return roster.teams.map((team) => ({
    teamId: team.id,
    name: team.name,
    shortName: team.shortName || team.name,
    tla: team.tla || "",
    leagueCode: code,
  }));
}

async function searchTeams(query: string, token: string): Promise<TeamRecord[]> {
  const q = normalizeName(query);
  if (!q) return [];

  const all: TeamRecord[] = [];
  for (const code of leagueCodes()) {
    try {
      all.push(...await loadLeagueTeams(code, token));
    } catch {
      // skip unavailable league
    }
  }

  const scored = all.map((team) => ({ team, score: scoreTeamMatch(q, team) }));

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.team.name.localeCompare(b.team.name))
    .slice(0, 8)
    .map((item) => item.team);
}

function formatCandidates(results: TeamRecord[], query?: string): string {
  if (results.length === 0) return `No teams found${query ? ` for "${query}"` : ""}.`;
  const header = query ? `Search results for "${query}":` : "Last search results:";
  const rows = results.map((team, index) => `${index + 1}. ${team.name} | ${team.leagueCode}${team.tla ? ` | ${team.tla}` : ""}`);
  return `${header}\n${rows.join("\n")}\nUse: /soccer:add <number> or /soccer:favorite <number>`;
}

function formatWatchlistCandidates(results: TeamRecord[], config: SoccerConfig, query: string): string {
  const rows = results.map((team) => {
    const index = config.teams.findIndex((item) => item.teamId === team.teamId);
    return `${index + 1}. ${teamLabel(team)}`;
  });
  return `Multiple watchlist teams match "${query}".\n${rows.join("\n")}\nUse: /soccer:remove <watchlist number>`;
}

function parseIndex(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

async function teamFromArg(arg: string, token: string): Promise<{ team?: TeamRecord; candidates?: TeamRecord[]; message?: string }> {
  const value = arg.trim();
  if (!value) return { message: "Missing team. Use /soccer:search <name>." };

  const index = parseIndex(value);
  if (index !== null) {
    const cache = readSearchCache();
    const team = cache?.results[index - 1];
    if (!team) return { message: `No cached search result #${index}. Run /soccer:search <name> first.` };
    return { team };
  }

  const candidates = await searchTeams(value, token);
  writeSearchCache(value, candidates);
  if (candidates.length === 0) return { message: `No teams found for "${value}".` };

  const q = normalizeName(value);
  const exact = candidates.filter((team) => [team.name, team.shortName, team.tla].map(normalizeName).includes(q));
  if (exact.length === 1) return { team: exact[0] };
  if (candidates.length === 1) return { team: candidates[0] };
  return { candidates };
}

function teamFromConfigArg(arg: string, config: SoccerConfig): { team?: TeamRecord; candidates?: TeamRecord[] } {
  const value = arg.trim();
  const index = parseIndex(value);
  if (index !== null) return { team: config.teams[index - 1] };
  if (!value) return {};

  const scored = config.teams
    .map((team) => ({ team, score: scoreTeamMatch(value, team) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.team.name.localeCompare(b.team.name));

  if (scored.length === 0) return {};
  const bestScore = scored[0].score;
  const best = scored.filter((item) => item.score === bestScore).map((item) => item.team);
  if (best.length === 1) return { team: best[0] };
  return { candidates: best };
}

function addTeam(config: SoccerConfig, team: TeamRecord): SoccerConfig {
  const teams = uniqueTeams([...config.teams, team]);
  return {
    ...config,
    favoriteTeamId: config.favoriteTeamId ?? team.teamId,
    teams,
  };
}

function removeTeam(config: SoccerConfig, teamId: number): SoccerConfig {
  const teams = config.teams.filter((team) => team.teamId !== teamId);
  const favoriteTeamId = config.favoriteTeamId === teamId ? teams[0]?.teamId ?? null : config.favoriteTeamId;
  return { ...config, teams, favoriteTeamId };
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function offsetDateStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtLocalDateTime(utcDate: string): string {
  const d = new Date(utcDate);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${m}/${day} ${hh}:${mm}`;
}

function teamFromStandingRow(row: StandingTableRow, leagueCode: string): TeamRecord {
  return {
    teamId: row.team.id,
    name: row.team.name,
    shortName: row.team.shortName || row.team.name,
    tla: row.team.tla || "",
    leagueCode,
  };
}

function standingFromRow(row: StandingTableRow): Standing {
  return { position: row.position, points: row.points, playedGames: row.playedGames };
}

async function fetchLeagueStandingRows(leagueCode: string, token: string): Promise<StandingTableRow[]> {
  const data = (await apiFetch(`/competitions/${leagueCode}/standings`, token)) as {
    standings: Array<{ type: string; table: StandingTableRow[] }>;
  };
  return data.standings.find((s) => s.type === "TOTAL")?.table ?? [];
}

async function fetchStanding(leagueCode: string, teamId: number, token: string): Promise<Standing | null> {
  try {
    const data = (await apiFetch(`/competitions/${leagueCode}/standings`, token)) as {
      standings: Array<{
        type: string;
        table: Array<{
          position: number;
          points: number;
          playedGames: number;
          team: { id: number; name: string };
        }>;
      }>;
    };
    const total = data.standings.find((s) => s.type === "TOTAL");
    const row = total?.table.find((r) => r.team.id === teamId);
    return row ? { position: row.position, points: row.points, playedGames: row.playedGames } : null;
  } catch {
    return null;
  }
}

async function fetchLastResult(teamId: number, token: string): Promise<MatchResult | null> {
  try {
    const data = (await apiFetch(`/teams/${teamId}/matches?dateFrom=${offsetDateStr(-120)}&dateTo=${todayStr()}`, token)) as { matches: MatchEntry[] };
    const finished = data.matches.filter((m) => m.status === "FINISHED").sort((a, b) => (a.utcDate < b.utcDate ? 1 : -1));
    if (finished.length === 0) return null;
    const m = finished[0];
    const isHome = m.homeTeam.id === teamId;
    const winner = m.score.winner;
    const wdl = winner === "DRAW" || winner === null ? "D" : (winner === "HOME_TEAM" && isHome) || (winner === "AWAY_TEAM" && !isHome) ? "W" : "L";
    return {
      utcDate: m.utcDate,
      homeShort: shortTeamName(m.homeTeam),
      awayShort: shortTeamName(m.awayTeam),
      homeScore: m.score.fullTime.home,
      awayScore: m.score.fullTime.away,
      wdl,
    };
  } catch {
    return null;
  }
}

async function fetchNextMatch(teamId: number, token: string): Promise<NextMatch | null> {
  try {
    const data = (await apiFetch(`/teams/${teamId}/matches?dateFrom=${todayStr()}&dateTo=${offsetDateStr(120)}`, token)) as { matches: MatchEntry[] };
    const upcoming = data.matches.filter((m) => ["SCHEDULED", "TIMED"].includes(m.status)).sort((a, b) => (a.utcDate < b.utcDate ? -1 : 1));
    if (upcoming.length === 0) return null;
    const m = upcoming[0];
    const opponent = m.homeTeam.id === teamId ? m.awayTeam : m.homeTeam;
    return { utcDate: m.utcDate, opponentShort: shortTeamName(opponent) };
  } catch {
    return null;
  }
}

async function fetchSnapshot(
  team: TeamRecord,
  token: string,
  standing: Standing | null,
  source: "watchlist" | "discovery",
): Promise<TeamSnapshot> {
  const [lastResult, nextMatch] = await Promise.all([
    fetchLastResult(team.teamId, token),
    fetchNextMatch(team.teamId, token),
  ]);
  return { team, standing, lastResult, nextMatch, fetchedAt: Date.now(), source };
}

async function syncData(config: SoccerConfig, token: string, options?: { force?: boolean }): Promise<SnapshotCache> {
  const current = readSnapshotCache();
  const now = Date.now();
  if (!options?.force && now - current.timestamp < SNAPSHOT_TTL_MS) return current;
  if (!options?.force && current.lastSyncStartedAt && now - current.lastSyncStartedAt < SYNC_LOCK_MS) return current;

  const next: SnapshotCache = {
    ...current,
    lastSyncStartedAt: now,
    snapshots: { ...current.snapshots },
    discoveryTeamIds: current.discoveryTeamIds ?? [],
  };
  writeSnapshotCache(next);

  const standingsByLeague = new Map<string, StandingTableRow[]>();
  const loadStandings = async (leagueCode: string): Promise<StandingTableRow[]> => {
    if (!standingsByLeague.has(leagueCode)) {
      standingsByLeague.set(leagueCode, await fetchLeagueStandingRows(leagueCode, token));
    }
    return standingsByLeague.get(leagueCode) ?? [];
  };

  for (const team of config.teams) {
    try {
      const rows = await loadStandings(team.leagueCode);
      const row = rows.find((item) => item.team.id === team.teamId);
      next.snapshots[String(team.teamId)] = await fetchSnapshot(
        team,
        token,
        row ? standingFromRow(row) : await fetchStanding(team.leagueCode, team.teamId, token),
        "watchlist",
      );
    } catch {
      // Keep old snapshot on per-team sync failure.
    }
  }

  const leagues = leagueCodes();
  const league = leagues[Math.floor(Math.random() * leagues.length)] ?? leagues[0];
  if (league) {
    try {
      const rows = (await loadStandings(league)).slice(0, DISCOVERY_TOP_N);
      next.discoveryLeagueCode = league;
      next.discoveryTeamIds = rows.map((row) => row.team.id);
      for (const row of rows) {
        const team = teamFromStandingRow(row, league);
        next.snapshots[String(team.teamId)] = await fetchSnapshot(team, token, standingFromRow(row), "discovery");
      }
    } catch {
      // Keep old discovery pool on sync failure.
    }
  }

  next.timestamp = Date.now();
  next.lastSyncStartedAt = undefined;
  writeSnapshotCache(next);
  return next;
}

function snapshotScore(snapshot: TeamSnapshot | null | undefined): number {
  if (!snapshot) return 0;
  let score = 0;
  if (snapshot.lastResult) score += 2;
  if (snapshot.nextMatch) score += 3;
  if (snapshot.standing) score += 1;
  return score;
}

function chooseSnapshot(config: SoccerConfig, cache = readSnapshotCache()): TeamSnapshot | null {
  const favorite = config.teams.find((team) => team.teamId === config.favoriteTeamId) ?? config.teams[0];
  if (!favorite) return null;

  const favoriteSnapshot = cache.snapshots[String(favorite.teamId)];
  const watchlist = config.teams.map((team) => cache.snapshots[String(team.teamId)]).filter(Boolean) as TeamSnapshot[];
  const discovery = (cache.discoveryTeamIds ?? []).map((id) => cache.snapshots[String(id)]).filter(Boolean) as TeamSnapshot[];
  const fallbackPool = [...watchlist, ...discovery]
    .filter((snapshot) => snapshot.team.teamId !== favorite.teamId && snapshot.team.teamId !== config.lastShownTeamId);
  const fullPool = fallbackPool.length > 0
    ? fallbackPool
    : [...watchlist, ...discovery].filter((snapshot) => snapshot.team.teamId !== favorite.teamId);

  if (favoriteSnapshot?.lastResult && favoriteSnapshot.nextMatch) return favoriteSnapshot;
  const fallback = fullPool.sort((a, b) => snapshotScore(b) - snapshotScore(a))[0];
  if (!favoriteSnapshot) return fallback ?? null;
  if (!fallback) return favoriteSnapshot;
  return snapshotScore(fallback) >= snapshotScore(favoriteSnapshot) ? fallback : favoriteSnapshot;
}

function renderLoading(teamName: string, theme: Theme): string[] {
  return [theme.fg("dim", `Soccer: ${teamName} Loading...`)];
}

function renderNoToken(theme: Theme): string[] {
  return [theme.fg("dim", "Soccer: API key not set. Run /soccer:setup")];
}

function renderNoTeams(theme: Theme): string[] {
  return [
    theme.fg("dim", "Soccer: no favorite team yet"),
    theme.fg("dim", "Run /soccer:setup or /soccer:pick"),
  ];
}

function renderError(msg: string, theme: Theme): string[] {
  return [theme.fg("error", `Soccer error: ${msg}`)];
}

function renderSnapshot(snapshot: TeamSnapshot, config: SoccerConfig, theme: Theme): string[] {
  const isFavorite = snapshot.team.teamId === config.favoriteTeamId;
  const marker = isFavorite ? "favorite" : snapshot.source === "discovery" ? "discovery" : "watchlist";
  const teamPart = theme.fg("accent", snapshot.team.shortName || snapshot.team.name);
  let firstLine = `Soccer: ${teamPart} | ${snapshot.team.leagueCode}`;
  if (snapshot.standing) firstLine += theme.fg("dim", ` #${snapshot.standing.position} | ${snapshot.standing.points}pts`);
  firstLine += theme.fg("dim", ` | ${marker} | cache ${ageText(snapshot.fetchedAt)}`);

  const lines = [firstLine];
  if (snapshot.lastResult) {
    const hs = snapshot.lastResult.homeScore ?? "?";
    const as = snapshot.lastResult.awayScore ?? "?";
    const score = `${snapshot.lastResult.homeShort} ${hs}-${as} ${snapshot.lastResult.awayShort}`;
    const color = snapshot.lastResult.wdl === "W" ? "success" : snapshot.lastResult.wdl === "L" ? "error" : "muted";
    lines.push(`Last: ${score}  ${theme.fg(color, snapshot.lastResult.wdl)}`);
  } else {
    lines.push(theme.fg("dim", "Last: no recent result"));
  }

  if (snapshot.nextMatch) {
    lines.push(`Next: vs ${snapshot.nextMatch.opponentShort} | ${fmtLocalDateTime(snapshot.nextMatch.utcDate)}`);
  } else {
    lines.push(theme.fg("dim", "Next: no upcoming match"));
  }
  return lines;
}

async function refreshWidget(setWidget: SetWidget, theme: Theme, options?: { forceSync?: boolean }): Promise<void> {
  const config = currentConfig ?? readConfig();
  currentConfig = config;

  if (shouldUseWorldCupWidget(config)) {
    await refreshWorldCupWidget(setWidget, theme, config, options);
    return;
  }

  const { token } = resolveApiToken();
  if (!token) {
    setWidget(WIDGET_ID, renderNoToken(theme));
    return;
  }

  if (config.teams.length === 0) {
    setWidget(WIDGET_ID, renderNoTeams(theme));
    return;
  }

  const activeConfig = currentConfig ?? config;
  const label = activeConfig.teams.find((team) => team.teamId === activeConfig.favoriteTeamId)?.shortName
    ?? activeConfig.teams[0]?.shortName
    ?? "team";
  setWidget(WIDGET_ID, renderLoading(label, theme));

  try {
    const cache = await syncData(activeConfig, token, { force: options?.forceSync });
    const snapshot = chooseSnapshot(activeConfig, cache);
    if (!snapshot) {
      setWidget(WIDGET_ID, renderNoTeams(theme));
      return;
    }
    writeConfig({ ...activeConfig, lastShownTeamId: snapshot.team.teamId });
    setWidget(WIDGET_ID, renderSnapshot(snapshot, currentConfig ?? activeConfig, theme));
  } catch (err) {
    const stale = chooseSnapshot(activeConfig);
    if (stale) {
      setWidget(WIDGET_ID, renderSnapshot(stale, currentConfig ?? activeConfig, theme));
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    setWidget(WIDGET_ID, renderError(msg, theme));
  }
}

function showText(ctx: any, text: string, level: "info" | "warning" | "error" = "info"): void {
  ctx.ui.notify(text, level);
}

function apiKeyGuideText(): string {
  return [
    "Football-data API key setup:",
    `1. Open: ${SIGNUP_URL}`,
    "2. Create a free football-data.org account.",
    "3. Check your email. The API key is sent by email after signup.",
    "4. Return to Pi and run: /soccer:login",
    `Docs: ${DOCS_URL}`,
  ].join("\n");
}

async function ensureTokenForSetup(ctx: any): Promise<string | undefined> {
  let { token } = resolveApiToken();
  if (token) return token;
  showText(ctx, apiKeyGuideText(), "warning");
  const entered = await ctx.ui.input("Paste Football-data.org API key from email:", "API key");
  const apiKey = String(entered ?? "").trim();
  if (!apiKey) {
    showText(ctx, "API key was not saved.", "warning");
    return undefined;
  }
  writeStoredToken(apiKey);
  showText(ctx, "Saved Football-data API key. It was handled by extension UI and not sent to the model.");
  return apiKey;
}

async function pickTeam(ctx: any, token: string, options?: { addOnly?: boolean }): Promise<TeamRecord | null> {
  const query = String(await ctx.ui.input("Search soccer team:", "e.g. Arsenal, Barcelona, Madrid") ?? "").trim();
  if (!query) return null;
  const results = await searchTeams(query, token);
  writeSearchCache(query, results);
  if (results.length === 0) {
    showText(ctx, `No teams found for "${query}".`, "warning");
    return null;
  }
  const labels = results.map((team, index) => `${index + 1}. ${team.name} | ${team.leagueCode}${team.tla ? ` | ${team.tla}` : ""}`);
  const selected = await ctx.ui.select(options?.addOnly ? "Add team to watchlist:" : "Choose favorite team:", labels);
  if (!selected) return null;
  const index = labels.indexOf(selected);
  return index >= 0 ? results[index] : null;
}

async function confirmGuessedWorldCupCountry(ctx: any, team: TeamRecord, source: string): Promise<boolean> {
  const title = `Follow ${team.name}?`;
  const detail = `Suggested from ${source}. Confirm before saving as your World Cup country.`;
  if (typeof ctx.ui.confirm === "function") return Boolean(await ctx.ui.confirm(title, detail));
  const selected = await ctx.ui.select(`${title} ${detail}`, ["Yes", "No"]);
  return selected === "Yes";
}

async function pickWorldCupCountry(ctx: any): Promise<TeamRecord | null> {
  const query = String(await ctx.ui.input("Search country to follow:", "e.g. Japan, USA, Brazil") ?? "").trim();
  if (!query) return null;
  const results = findNationalTeams(query);
  if (results.length === 0) {
    showText(ctx, `No countries found for "${query}".`, "warning");
    return null;
  }

  const labels = results.map((team, index) => `${index + 1}. ${nationalTeamLabel(team)}`);
  const selected = await ctx.ui.select("Choose World Cup country:", labels);
  if (!selected) return null;
  const index = labels.indexOf(selected);
  return index >= 0 ? results[index] : null;
}

async function ensureWorldCupCountry(ctx: any, config: SoccerConfig): Promise<SoccerConfig | null> {
  if (followedWorldCupTeam(config)) return config;

  const configuredGuess = guessWorldCupCountryFromConfiguredEnv();
  if (configuredGuess && await confirmGuessedWorldCupCountry(ctx, configuredGuess.team, configuredGuess.source)) {
    const next = setFollowedWorldCupTeam(config, configuredGuess.team);
    writeConfig(next);
    showText(ctx, `World Cup country saved: ${nationalTeamLabel(configuredGuess.team)}`);
    return next;
  }

  const localeGuess = guessWorldCupCountryFromLocaleTimezone();
  if (localeGuess && await confirmGuessedWorldCupCountry(ctx, localeGuess.team, localeGuess.source)) {
    const next = setFollowedWorldCupTeam(config, localeGuess.team);
    writeConfig(next);
    showText(ctx, `World Cup country saved: ${nationalTeamLabel(localeGuess.team)}`);
    return next;
  }

  const picked = await pickWorldCupCountry(ctx);
  if (!picked) {
    showText(ctx, "World Cup country was not saved.", "warning");
    return null;
  }
  const next = setFollowedWorldCupTeam(config, picked);
  writeConfig(next);
  showText(ctx, `World Cup country saved: ${nationalTeamLabel(picked)}`);
  return next;
}

async function showWorldCupMenu(ctx: any, config: SoccerConfig): Promise<void> {
  const followed = followedWorldCupTeam(config);
  const title = followed ? `World Cup | ${followed.shortName}` : "World Cup";
  const selected = await ctx.ui.select(title, [...WORLD_CUP_MENU_ITEMS]);
  if (!selected) return;

  if (selected === "Follow my country") {
    const picked = await pickWorldCupCountry(ctx);
    if (!picked) return;
    const next = setFollowedWorldCupTeam(config, picked);
    writeConfig(next);
    showText(ctx, `World Cup country saved: ${nationalTeamLabel(picked)}`);
    return;
  }

  if (selected === "Settings") {
    const current = followedWorldCupTeam(config);
    const mode = shouldUseWorldCupWidget(config) ? "World Cup" : "club";
    const choice = await ctx.ui.select(`World Cup settings | default widget: ${mode}`, [
      "Use World Cup widget",
      "Use club widget",
      "Show current settings",
    ]);
    if (choice === "Use World Cup widget" || choice === "Use club widget") {
      const next = setWorldCupWidgetMode(config, choice === "Use World Cup widget" ? "worldcup" : "club");
      writeConfig(next);
      currentConfig = next;
      showText(ctx, `World Cup default widget: ${choice === "Use World Cup widget" ? "World Cup" : "club"}`);
      resetRefreshTimer(ctx);
      await refreshWidget((id, lines) => ctx.ui.setWidget(id, lines), ctx.ui.theme, { forceSync: false });
      return;
    }
    showText(ctx, `World Cup settings:\nFollowed country: ${current ? nationalTeamLabel(current) : "not set"}\nDefault widget: ${mode}`);
    return;
  }

  const { token } = resolveApiToken();
  if (!token) {
    showText(ctx, "Football-data API key is not set. Run /soccer:setup.", "warning");
    return;
  }

  let snapshot: WorldCupSnapshot;
  try {
    snapshot = await syncWorldCupData(config, token, { force: selected === "Match detail" });
  } catch (err) {
    showText(ctx, err instanceof Error ? err.message : String(err), "warning");
    return;
  }

  if (selected === "Today's matches") {
    showText(ctx, formatWorldCupToday(snapshot));
    return;
  }

  if (selected === "Group table") {
    showText(ctx, formatWorldCupGroup(snapshot));
    return;
  }

  if (selected === "Top scorers") {
    showText(ctx, formatWorldCupTopScorers(snapshot), snapshot.topScorersAvailable ? "info" : "warning");
    return;
  }

  if (selected === "Match detail") {
    const baseMatch = chooseWorldCupMatch(snapshot.matches, snapshot.team);
    const detail = baseMatch?.id ? await fetchWorldCupMatchDetail(baseMatch.id, token) : null;
    showText(ctx, formatWorldCupMatchDetail(detail ?? baseMatch, snapshot), detail || baseMatch ? "info" : "warning");
  }
}

async function handleWorldCupCommand(_args: string, ctx: any): Promise<void> {
  let config = currentConfig ?? readConfig();
  config = await ensureWorldCupCountry(ctx, config) ?? config;
  if (!followedWorldCupTeam(config)) return;
  currentConfig = config;
  await showWorldCupMenu(ctx, config);
}

async function handleSoccerCommand(args: string, ctx: any): Promise<void> {
  const theme = ctx.ui.theme;
  const trimmed = String(args || "").trim();
  const [commandRaw, ...rest] = trimmed.split(/\s+/).filter(Boolean);
  const command = (commandRaw ?? "").toLowerCase();
  const value = rest.join(" ");

  if (["get-key", "key", "api-key"].includes(command)) {
    showText(ctx, apiKeyGuideText());
    return;
  }

  if (command === "login") {
    const entered = await ctx.ui.input("Football-data.org API key:", "paste API key here");
    const apiKey = String(entered ?? "").trim();
    if (!apiKey) {
      showText(ctx, "API key was not saved.", "warning");
      return;
    }
    writeStoredToken(apiKey);
    showText(ctx, "Saved Football-data API key for pi-soccer-widget. The key was handled by the extension UI and not sent to the model.");
    await refreshWidget((id, lines) => ctx.ui.setWidget(id, lines), theme);
    return;
  }

  if (command === "logout") {
    removeStoredToken();
    showText(ctx, "Removed stored pi-soccer-widget API key. Environment variables are unchanged.");
    await refreshWidget((id, lines) => ctx.ui.setWidget(id, lines), theme);
    return;
  }

  if (command === "status") {
    showText(ctx, authStatusText());
    return;
  }

  const token = command === "setup" ? await ensureTokenForSetup(ctx) : resolveApiToken().token;

  if (!token) {
    showText(ctx, "Football-data API key is not set. Run /soccer:setup.", "warning");
    ctx.ui.setWidget(WIDGET_ID, renderNoToken(theme));
    return;
  }

  let config = currentConfig ?? readConfig();

  if (command === "setup") {
    const picked = await pickTeam(ctx, token);
    if (!picked) return;
    config = addTeam(config, picked);
    config.favoriteTeamId = picked.teamId;
    writeConfig(config);
    await syncData(config, token, { force: true });
    showText(ctx, `Favorite set: ${teamLabel(picked)}`);
    await refreshWidget((id, lines) => ctx.ui.setWidget(id, lines), theme);
    return;
  }

  if (!command) {
    await refreshWidget((id, lines) => ctx.ui.setWidget(id, lines), theme);
    return;
  }

  if (command === "sync") {
    const cache = await syncData(config, token, { force: true });
    showText(ctx, `Soccer data synced. Discovery league: ${cache.discoveryLeagueCode ?? "none"}`);
    await refreshWidget((id, lines) => ctx.ui.setWidget(id, lines), theme);
    return;
  }

  if (command === "pick") {
    const picked = await pickTeam(ctx, token);
    if (!picked) return;
    config = addTeam(config, picked);
    config.favoriteTeamId = picked.teamId;
    writeConfig(config);
    await syncData(config, token, { force: true });
    showText(ctx, `Favorite set: ${teamLabel(picked)}`);
    await refreshWidget((id, lines) => ctx.ui.setWidget(id, lines), theme);
    return;
  }

  if (command === "search") {
    const results = await searchTeams(value, token);
    writeSearchCache(value, results);
    showText(ctx, formatCandidates(results, value), results.length ? "info" : "warning");
    return;
  }

  if (command === "list") {
    if (config.teams.length === 0) {
      showText(ctx, "No teams in watchlist. Run /soccer:pick.", "warning");
      return;
    }
    const rows = config.teams.map((team, index) => `${index + 1}. ${teamLabel(team)}${team.teamId === config.favoriteTeamId ? " (favorite)" : ""}`);
    showText(ctx, `Soccer watchlist:\n${rows.join("\n")}`);
    return;
  }

  if (["add", "favorite", "fav"].includes(command)) {
    const result = await teamFromArg(value, token);
    if (result.candidates) {
      showText(ctx, formatCandidates(result.candidates, value), "warning");
      return;
    }
    if (!result.team) {
      showText(ctx, result.message ?? "Team not found.", "warning");
      return;
    }
    config = addTeam(config, result.team);
    if (command === "favorite" || command === "fav") {
      config.favoriteTeamId = result.team.teamId;
    }
    writeConfig(config);
    showText(ctx, `${command === "add" ? "Added" : "Favorite set"}: ${teamLabel(result.team)}`);
    await syncData(config, token, { force: true });
    await refreshWidget((id, lines) => ctx.ui.setWidget(id, lines), theme);
    return;
  }

  if (command === "remove" || command === "rm") {
    const result = teamFromConfigArg(value, config);
    const team = result.team;
    if (result.candidates) {
      showText(ctx, formatWatchlistCandidates(result.candidates, config, value), "warning");
      return;
    }
    if (!team) {
      showText(ctx, "Team not found in watchlist. Use /soccer:list.", "warning");
      return;
    }
    writeConfig(removeTeam(config, team.teamId));
    showText(ctx, `Removed: ${teamLabel(team)}`);
    await refreshWidget((id, lines) => ctx.ui.setWidget(id, lines), theme);
    return;
  }

  // Backward-compatible shorthand: /soccer Arsenal means set favorite if unambiguous.
  const shorthand = trimmed;
  const result = await teamFromArg(shorthand, token);
  if (result.candidates) {
    showText(ctx, formatCandidates(result.candidates, shorthand), "warning");
    return;
  }
  if (!result.team) {
    showText(ctx, result.message ?? `Unknown command: ${command}`, "warning");
    return;
  }
  config = addTeam(config, result.team);
  config.favoriteTeamId = result.team.teamId;
  writeConfig(config);
  showText(ctx, `Favorite set: ${teamLabel(result.team)}`);
  await syncData(config, token, { force: true });
  await refreshWidget((id, lines) => ctx.ui.setWidget(id, lines), theme);
}

function completionItem(value: string, description: string): { value: string; label: string; description: string } {
  return { value, label: value, description };
}

function getSoccerCompletions(prefix: string): Array<{ value: string; label: string; description: string }> | null {
  const text = String(prefix ?? "").trimStart();
  const parts = text.split(/\s+/).filter(Boolean);
  const command = (parts[0] ?? "").toLowerCase();

  if (parts.length <= 1 && !text.endsWith(" ")) {
    const items = COMMANDS
      .filter(([cmd]) => cmd.startsWith(command))
      .map(([cmd, desc]) => completionItem(cmd, desc));
    return items.length ? items : null;
  }

  if (["favorite", "fav", "add"].includes(command)) {
    const typed = parts[1] ?? "";
    const items = (readSearchCache()?.results ?? [])
      .map((team, index) => completionItem(`${command} ${index + 1}`, teamLabel(team)))
      .filter((item) => item.value.startsWith(`${command} ${typed}`));
    return items.length ? items : null;
  }

  if (["remove", "rm"].includes(command)) {
    const typed = parts[1] ?? "";
    const config = currentConfig ?? readConfig();
    const items = config.teams
      .map((team, index) => completionItem(`${command} ${index + 1}`, teamLabel(team)))
      .filter((item) => item.value.startsWith(`${command} ${typed}`));
    return items.length ? items : null;
  }

  return null;
}

function resetRefreshTimer(ctx: any): void {
  clearRefreshTimer();
  const intervalMs = shouldUseWorldCupWidget(currentConfig ?? readConfig()) ? WORLD_CUP_REFRESH_MS : SNAPSHOT_TTL_MS;
  refreshTimer = setInterval(() => {
    void (async () => {
      const ui = ctx.ui;
      await refreshWidget((id, lines) => ui.setWidget(id, lines), ui.theme);
    })().catch((error) => {
      if (isStaleContextError(error)) {
        clearRefreshTimer();
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      try {
        ctx.ui.notify(`Soccer widget refresh failed: ${message}`, "warning");
      } catch {
        // Timer callbacks must never crash Pi if the UI is unavailable.
      }
    });
  }, intervalMs);
  refreshTimer.unref?.();
}

export const __testing = {
  editDistance,
  findNationalTeams,
  followedWorldCupTeam,
  formatWorldCupGroup,
  formatWorldCupTopScorers,
  fuzzyScore,
  guessWorldCupCountryFromConfiguredEnv,
  guessWorldCupCountryFromLocaleTimezone,
  renderWorldCupSnapshot,
  normalizeName,
  scoreTeamMatch,
  setFollowedWorldCupTeam,
  shouldUseWorldCupWidget,
  teamFromConfigArg,
};

export default function soccerWidgetExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    currentConfig = readConfig();
    await refreshWidget((id, lines) => ctx.ui.setWidget(id, lines), ctx.ui.theme);

    resetRefreshTimer(ctx);
  });

  pi.on("session_shutdown", () => {
    clearRefreshTimer();
  });

  pi.registerCommand("soccer", {
    description: "Show soccer widget. Setup, sync, pick, and manage teams.",
    getArgumentCompletions: getSoccerCompletions,
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      await handleSoccerCommand(args, ctx);
    },
  });

  for (const alias of COLON_COMMAND_ALIASES) {
    pi.registerCommand(alias.name, {
      description: `Soccer: ${alias.description}. Alias for /soccer:${alias.command}.`,
      handler: async (args, ctx) => {
        if (!ctx.hasUI) return;
        const value = String(args ?? "").trim();
        await handleSoccerCommand(value ? `${alias.command} ${value}` : alias.command, ctx);
      },
    });
  }

  for (const alias of WORLD_CUP_COMMAND_ALIASES) {
    pi.registerCommand(alias.name, {
      description: `Soccer: ${alias.description}.`,
      handler: async (args, ctx) => {
        if (!ctx.hasUI) return;
        await handleWorldCupCommand(String(args ?? ""), ctx);
      },
    });
  }
}
