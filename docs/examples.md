# Examples

## Widget output (club mode)

```text
Soccer: Arsenal | PL #2 | 71pts | favorite
Last: Arsenal 2-1 Chelsea  W
Next: vs Liverpool | 5/24 20:00
```

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

## Local development

```bash
pi -e ./extensions/index.ts
```

Then in Pi:

```text
/reload
/soccer:status
```
