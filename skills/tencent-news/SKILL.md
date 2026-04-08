---
name: tencent-news
description: Fetch top and daily news using the Tencent News CLI.
command-dispatch: tool
command-tool: tencent_news
---

# Tencent News Skill

This skill allows the agent to fetch Tencent News updates for the user, providing the Morning update, Evening summary, Hot rankings, or performing specific searches.

## Usage

When a user asks for "morning news", "evening news", or "news hot list", invoke the `tencent_news` tool with the appropriate `command` string:

- `evening`: Fetches the Daily Evening News.
- `hot`: Extracts the latest trending topics.
- `morning`: Fetches the Daily Morning News.
- `search`: Searches for a specific topic (use the `query` parameter).

## Configuration

The Tencent News plugin uses the `tencent-news-cli`. By default, it expects the binary to be in your system's `PATH`.

If the CLI is installed in a specific directory (common when running OpenClaw as a background service via `launchd`), you can configure the absolute path in your `openclaw.yaml`:

```yaml
tools:
  tencentNews:
    binaryPath: /path/to/your/pnpm/bin/tencent-news-cli
```

### API Key configuration

The API Key for this service can be updated directly via the shell using:
`tencent-news-cli apikey-set <YOUR_API_KEY>`
