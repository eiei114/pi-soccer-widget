export interface TeamNameCandidate {
  name: string;
  shortName?: string;
  tla?: string;
}

export function normalizeName(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function editDistance(a: string, b: string): number {
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

function editDistanceAtMost(a: string, b: string, maximum: number): number {
  const exceedsMaximum = maximum + 1;
  if (Math.abs(a.length - b.length) > maximum) return exceedsMaximum;

  let previous = Array.from({ length: b.length + 1 }, (_, index) =>
    index <= maximum ? index : exceedsMaximum,
  );
  let current = new Array<number>(b.length + 1).fill(exceedsMaximum);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i <= maximum ? i : exceedsMaximum;
    const firstColumn = Math.max(1, i - maximum);
    const lastColumn = Math.min(b.length, i + maximum);
    if (firstColumn > 1) current[firstColumn - 1] = exceedsMaximum;

    for (let j = firstColumn; j <= lastColumn; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    if (lastColumn < b.length) current[lastColumn + 1] = exceedsMaximum;

    [previous, current] = [current, previous];
  }

  return previous[b.length] <= maximum ? previous[b.length] : exceedsMaximum;
}

export function fuzzyScore(query: string, name: string): number {
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
  const maxDistance = q.length >= 10 ? 3 : q.length >= 6 ? 2 : 1;
  return variants.reduce((best, variant) => {
    const longest = Math.max(q.length, variant.length);
    const distance = editDistanceAtMost(q, variant, maxDistance);
    const similarity = 1 - distance / longest;
    if (distance <= 1 && q.length >= 4) return Math.max(best, 65);
    if (distance <= 2 && q.length >= 6 && similarity >= 0.72) return Math.max(best, 58);
    if (distance <= 3 && q.length >= 10 && similarity >= 0.78) return Math.max(best, 52);
    return best;
  }, 0);
}

export function scoreTeamMatch(query: string, team: TeamNameCandidate): number {
  const aliases = [team.name, team.shortName, team.tla].filter((alias): alias is string => Boolean(alias));
  return Math.max(0, ...aliases.map((alias) => fuzzyScore(query, alias)));
}
