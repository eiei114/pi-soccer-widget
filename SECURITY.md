# Security Policy

Please report security issues privately instead of opening a public issue.

## API key storage

`/soccer login` accepts the Football-data API key through Pi extension UI. The input is handled by the extension command and is not sent to the model/chat context.

The key is stored locally at `~/.pi/agent/pi-soccer-widget-auth.json` with a best-effort `0600` file mode. `FOOTBALL_DATA_API_TOKEN` environment variable still takes priority when set.

Use `/soccer logout` to remove the stored key.
