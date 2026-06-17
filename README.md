# chrome hearts monitor

Cloudflare Worker that watches the Chrome Hearts storefront and posts new drops
and restocks to Discord.

Cloudflare's cron floor is 60 seconds, too slow to be early on a drop, so a
Durable Object alarm re-arms itself every ~15s instead. State lives in KV.
Settings, live status and logs are on the worker's dashboard route.

```bash
npm test
npx wrangler dev
npx wrangler deploy
```

Copy `.dev.vars.example` to `.dev.vars` and add a Discord webhook. Not affiliated
with Chrome Hearts.

Built by [Gabe Hassan](https://gabehassan.com)
