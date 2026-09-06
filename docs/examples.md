# Examples

## Widget output (club mode)

```text
Soccer: Arsenal | PL #2 | 71pts | favorite | cache 2h ago
Last: Arsenal 2-1 Chelsea  W
Next: vs Liverpool | 5/24 20:00
```

The first line ends with a source marker (`favorite`, `watchlist`, or `discovery`) and a cache-age hint from the 6-hour snapshot TTL.

## Typical setup flow

```text
/soccer:setup
/soccer:status
/soccer:search Arsenal
/soccer:add Arsenal
/soccer:favorite Arsenal
/soccer:list
```

## Watchlist maintenance

```text
/soccer:search "Real Madrid"
/soccer:add
/soccer:remove
/soccer:sync
```

Omitting the team name on `/soccer:add`, `/soccer:favorite`, or `/soccer:remove` opens the Pi UI picker.

## World Cup flow

```text
/soccer:worldcup
```

From the menu, pick followed country setup, today's matches, group table, match detail, top scorers, or settings to switch default widget mode.

## Widget output (World Cup mode)

```text
World Cup: Japan | Group B #2 | 4pts | cache 15m ago | sync ~10m
Japan 2-2 Germany | IN_PLAY | Group B
Goals: Aoki 12', Germany: Muller 44'
Notes: 1 red card | pens 4-3
```

Matchday widgets use a shorter sync cadence (`sync ~10m`); off-matchday snapshots show `sync ~60m` instead.

## Local development

```bash
pi -e ./extensions/index.ts
```

Then in Pi:

```text
/reload
/soccer:status
```
