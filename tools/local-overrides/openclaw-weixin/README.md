## Local Weixin Overrides

This directory is the repo-managed source of truth for local `openclaw-weixin` hotfixes that
currently live under `~/.openclaw/extensions/openclaw-weixin`.

Why this exists:

- The Weixin plugin source is not part of this repository.
- Local edits under `~/.openclaw` can be overwritten by plugin reinstall or update.
- Keeping the important overrides here makes the current behavior traceable and re-applicable.

Managed files:

- `src/messaging/jiuyan-data-ops-intent.ts`
- `src/messaging/jiuyan-data-ops.ts`
- `src/messaging/process-message.ts`

Sync workflow:

- Capture the current local plugin files into this repo:
  - `node scripts/sync-local-openclaw-weixin-overrides.mjs --capture`
- Apply the repo-managed overrides back into the local plugin after an update:
  - `node scripts/sync-local-openclaw-weixin-overrides.mjs --apply`

This override layer is intentionally not wired into the main OpenClaw build. It exists so that
the local plugin changes are visible in git and can be re-applied quickly when the runtime plugin
is replaced.
