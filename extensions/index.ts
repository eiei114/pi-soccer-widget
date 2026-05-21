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
 *   PI_SOCCER_REFRESH_MIN    - refresh interval in minutes (default: 15)
 *   PI_SOCCER_LEAGUES        - comma-separated football-data league codes
 *
 * Commands:
 *   /soccer                  - refresh widget
 *   /soccer login            - enter and store Football-data API key via Pi UI
 *   /soccer status           - show API key status without exposing the key
 *   /soccer search <query>   - show candidate teams
 *   /soccer add <query|n>    - add team to watchlist
 *   /soccer favorite <query|n> - set favorite team
 *   /soccer list             - show watchlist
 *   /soccer remove <query|n> - remove team from watchlist
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
const SYNC_LOCK_MS = 5 * 60 * 1000;
const DISCOVERY_TOP_N = 3;

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

interface SoccerConfig {
  favoriteTeamId: number | null;
  teams: TeamRecord[];
  lastShownTeamId?: number;
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
}

interface MatchEntry {
  utcDate: string;
  status: string;
  homeTeam: { id: number; name: string; shortName: string };
  awayTeam: { id: number; name: string; shortName: string };
  score: {
    winner: "HOME_TEAM" | "AWAY_TEAM" | "DRAW" | null;
    fullTime: { home: number | null; away: number | null };
  };
}

interface StandingTableRow {
  position: number;
  points: number;
  playedGames: number;
  team: { id: number; name: string; shortName?: string; tla?: string };
}

let currentConfig: SoccerConfig | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

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

function readConfig(): SoccerConfig {
  const existing = readJson<SoccerConfig>(CONFIG_FILE);
  if (existing && Array.isArray(existing.teams)) {
    return {
      favoriteTeamId: existing.favoriteTeamId ?? existing.teams[0]?.teamId ?? null,
      teams: uniqueTeams(existing.teams),
      lastShownTeamId: existing.lastShownTeamId,
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
  currentConfig = {
    ...config,
    teams: uniqueTeams(config.teams),
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
    : "Football-data API key: not configured. Run /soccer setup.";
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

function shortTeamName(t: { name: string; shortName: string }): string {
  return t.shortName?.trim() || t.name;
}

function teamLabel(team: TeamRecord): string {
  const tla = team.tla ? ` | ${team.tla}` : "";
  return `${team.shortName || team.name} | ${team.leagueCode}${tla}`;
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

  const scored = all.map((team) => {
    const names = [team.name, team.shortName, team.tla].filter(Boolean).map(normalizeName);
    let score = 0;
    if (names.some((name) => name === q)) score = 100;
    else if (names.some((name) => name.startsWith(q))) score = 80;
    else if (names.some((name) => name.includes(q))) score = 60;
    else if (q.length >= 4 && names.some((name) => name.split(" ").some((part) => part.startsWith(q)))) score = 45;
    return { team, score };
  });

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
  return `${header}\n${rows.join("\n")}\nUse: /soccer add <number> or /soccer favorite <number>`;
}

function parseIndex(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

async function teamFromArg(arg: string, token: string): Promise<{ team?: TeamRecord; candidates?: TeamRecord[]; message?: string }> {
  const value = arg.trim();
  if (!value) return { message: "Missing team. Use /soccer search <name>." };

  const index = parseIndex(value);
  if (index !== null) {
    const cache = readSearchCache();
    const team = cache?.results[index - 1];
    if (!team) return { message: `No cached search result #${index}. Run /soccer search <name> first.` };
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
  return [theme.fg("dim", "Soccer: API key not set. Run /soccer setup")];
}

function renderNoTeams(theme: Theme): string[] {
  return [
    theme.fg("dim", "Soccer: no favorite team yet"),
    theme.fg("dim", "Run /soccer setup or /soccer pick"),
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
  const { token } = resolveApiToken();
  if (!token) {
    setWidget(WIDGET_ID, renderNoToken(theme));
    return;
  }

  const config = currentConfig ?? readConfig();
  currentConfig = config;

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
    "4. Return to Pi and run: /soccer login",
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
    showText(ctx, "Football-data API key is not set. Run /soccer setup.", "warning");
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
      showText(ctx, "No teams in watchlist. Run /soccer pick.", "warning");
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
    const index = parseIndex(value);
    let team: TeamRecord | undefined;
    if (index !== null) team = config.teams[index - 1];
    if (!team && value) {
      const q = normalizeName(value);
      team = config.teams.find((item) => [item.name, item.shortName, item.tla].map(normalizeName).some((name) => name === q || name.includes(q)));
    }
    if (!team) {
      showText(ctx, "Team not found in watchlist. Use /soccer list.", "warning");
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

export default function soccerWidgetExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    currentConfig = readConfig();
    await refreshWidget((id, lines) => ctx.ui.setWidget(id, lines), ctx.ui.theme);

    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    refreshTimer = setInterval(async () => {
      await refreshWidget((id, lines) => ctx.ui.setWidget(id, lines), ctx.ui.theme);
    }, SNAPSHOT_TTL_MS);
    refreshTimer.unref?.();
  });

  pi.registerCommand("soccer", {
    description: "Show soccer widget. Setup, sync, pick, and manage teams.",
    getArgumentCompletions: getSoccerCompletions,
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      await handleSoccerCommand(args, ctx);
    },
  });
}
