---
name: jiuyan-data-ops
description: Operate the local Jiuyan sales database and forecast exports from chat requests in Feishu or Weixin. Use when the user asks to update/import database data from attached Excel, CSV, or ZIP files, or asks to calculate demand, update a production plan, or calculate sales with optional month and SKU-scope parameters. This skill routes to the local scripts in /Users/andychan/Documents/jiuyan/utils and handles upload/export file movement plus success or invalid-file replies.
---

# Jiuyan Data Ops

Use this skill for Jiuyan business-data requests that arrive from chat, especially Feishu and Weixin.

The local workspace for all operations is:

- `/Users/andychan/Documents/jiuyan`
- scripts: `/Users/andychan/Documents/jiuyan/utils`
- upload dir: `/Users/andychan/Documents/jiuyan/upload`
- exports dir: `/Users/andychan/Documents/jiuyan/exports`
- scope input dir: `/Users/andychan/Documents/jiuyan/exports/_scope_inputs`

## Supported scenarios

1. Database import/update from an attached file
2. Demand / production-plan / sales export, optionally with month and SKU-scope parameters

## Trigger phrases

Treat these as intent matches, not exact strings.

### Preferred command prefixes

Prefer this skill immediately when the chat message starts with either prefix:

- `/生产计划`
- `/销量计算`

When one of these prefixes is present, do not treat the message as general conversation or generic math help. Strip the prefix, then execute this skill's business workflow directly.

### Import intent

- `更新数据库`
- `导入数据库`
- other close variants that clearly mean “import the attached sales or SKU master data into the Jiuyan database”

This scenario requires at least one attached file. Accept:

- `.xlsx`
- `.xls`
- `.csv`
- `.zip`

### Export intent

- `计算需求`
- `更新生产计划表`
- `更新生产计划`
- `计算销量`
- close variants that clearly mean “run the Jiuyan forecast export”

This scenario may include:

- a month count, such as `5个月`, `未来 6 个月`
- a SKU scope, such as `top 800 sku`
- a time window for the scope, such as `昨天 top 800 sku`, `上个月 top 800 sku`
- a referenced file, such as `更新表中 sku，未来 6 个月的生产计划表`

Recommended command-style examples:

- `/生产计划 计算未来 5 个月需求`
- `/生产计划 更新未来 6 个月生产计划表`
- `/生产计划 更新昨天 top 800 sku，未来 6 个月生产计划表`
- `/销量计算 计算未来 5 个月销量`

## Safety and execution rules

- Run only the Jiuyan scripts listed in this skill.
- Keep all destructive cleanup scoped to `/Users/andychan/Documents/jiuyan/upload` or `/Users/andychan/Documents/jiuyan/exports`.
- Before import, always clear `upload`.
- Before export, clear `exports` when a stale file could confuse which workbook to send back.
- Preserve the original attachment filename when copying into `upload` when feasible.
- If the user message is ambiguous but clearly belongs to one of these two scenarios, make the smallest reasonable assumption and continue.
- If the message starts with `/生产计划` or `/销量计算`, prefer executing the Jiuyan workflow over asking broad clarification questions. Only ask a follow-up when a required attachment or required parameter is actually missing.
- Do not treat a local filesystem path as a delivered file. A reply that only pastes `/Users/.../exports/...xlsx` is incomplete.
- Do not use `sessions_send` or plain text like `[attachment: /path/to/file.xlsx]` to deliver export workbooks. That does not create a real chat attachment.
- For exported Excel files, always use the `message` tool with the current channel's real attachment action. In Feishu, use `message` with `action: "sendAttachment"` and the generated workbook path as the attachment input.

## Scenario 1: Import database from attachment

### Required workflow

1. Verify that the chat message includes at least one attached file or referenced uploaded file.
2. Run:

```bash
python /Users/andychan/Documents/jiuyan/utils/clear_folders.py --upload
```

3. Move or copy the referenced attachment files into `/Users/andychan/Documents/jiuyan/upload`.
4. If any attachment is a ZIP archive, unpack it into `upload` and then inspect the extracted files. Ignore macOS metadata files such as `__MACOSX` and `.DS_Store`.
5. Run both import scripts:

```bash
cd /Users/andychan/Documents/jiuyan/utils
python import_sales.py
python import_skus.py
```

### Validity rule

- `import_sales.py` returns a valid import when it finds a sales file with the required columns.
- `import_skus.py` returns a valid import when it finds a SKU master file whose filename contains `全商品档案` and whose columns match its rules.
- If both scripts report invalid or unusable input, reply that the file is not valid for Jiuyan import.
- If either script succeeds, treat the overall request as successful and reply with the useful summary from the script output.

### Reply rules

- On total failure: tell the user the file is not valid, and briefly mention what was missing if the script output says so.
- On success: summarize the import result using the script output, for example new rows, updated rows, new SKUs, or filtered invalid rows.
- If both scripts succeed because the upload contains both sales data and SKU master data, summarize both.

## Scenario 2: Export demand / production plan / sales workbook

### Month parameter

Extract the month count from phrases like:

- `计算5个月的需求`
- `更新未来 6 个月生产计划表`
- `更新 6 个月的生产计划`
- `计算未来 5 个月销量`

If no month count is stated, use the script default.

Pass the month count to:

```bash
python /Users/andychan/Documents/jiuyan/utils/export_forecast.py --months <MONTHS>
```

### SKU scope modes

If the request does not limit SKU scope, run `export_forecast.py` directly.

If the request includes a scope, first build a scope workbook with `select_export_skus.py`, then pass that workbook into `export_forecast.py --sku-scope-file`.

Supported scope patterns:

- `top 800 sku`
- `昨天 top 800 sku`
- `上个月 top 800 sku`
- `表中 sku`

### Scope command mapping

For a plain `top N sku`, treat it as yesterday Top N unless the user states another window.

Examples:

- `昨天 top 800 sku`

```bash
python /Users/andychan/Documents/jiuyan/utils/select_export_skus.py --yesterday-top 800
```

- `上个月 top 800 sku`

```bash
python /Users/andychan/Documents/jiuyan/utils/select_export_skus.py --last-month-top 800
```

- `更新表中 sku，未来 6 个月的生产计划表`
  First clear stale exports so the new scope workbook is unambiguous:

```bash
python /Users/andychan/Documents/jiuyan/utils/clear_folders.py --exports
```

Then recreate the fixed scope-input folder and copy the referenced sheet into it:

```bash
mkdir -p /Users/andychan/Documents/jiuyan/exports/_scope_inputs
cp /absolute/path/to/referenced.xlsx /Users/andychan/Documents/jiuyan/exports/_scope_inputs/
```

Then run:

```bash
python /Users/andychan/Documents/jiuyan/utils/select_export_skus.py --from-file /Users/andychan/Documents/jiuyan/exports/_scope_inputs/input.xlsx
```

If the user provides multiple scope sources, pass all of them. `select_export_skus.py` already merges and deduplicates sources.

### Export workflow

1. If needed, clear stale exports:

```bash
python /Users/andychan/Documents/jiuyan/utils/clear_folders.py --exports
```

2. If scope is needed, run `select_export_skus.py` first and capture the generated workbook path from stdout.
   - For `表中 sku` requests, this export cleanup is required before `select_export_skus.py` runs, even if `exports` was already cleaned earlier in the turn.
   - For `表中 sku` requests, recreate `/Users/andychan/Documents/jiuyan/exports/_scope_inputs`, copy the referenced source file into that folder, and run `select_export_skus.py --from-file` against the copied file there.
   - Treat the generated candidate SKU workbook in `exports` as the required `--sku-scope-file` input for the forecast export.
3. Run `export_forecast.py`, passing:
   - `--months <MONTHS>` when a month count was provided
   - `--sku-scope-file <SCOPE_WORKBOOK>` when a scope workbook was generated
4. Find the newly generated Excel workbook in `/Users/andychan/Documents/jiuyan/exports`.
5. Send that workbook back to the user in chat as a real attachment with the `message` tool.
6. After the attachment send succeeds, reply with a short confirmation that mentions the month count and scope that were used.

### Required attachment send pattern

When an export succeeds, send the workbook before the confirmation text.

- Prefer the `message` tool over `sessions_send`.
- Prefer the channel's attachment action over plain text path pasting.
- In Feishu, call the `message` tool with `action: "sendAttachment"`.
- Point the attachment input at the generated workbook path in `/Users/andychan/Documents/jiuyan/exports`.
- If the `message` tool schema for the current run requires an explicit target, reuse the current inbound conversation target and reply context instead of guessing a new destination.
- Only fall back to a text-only reply if the attachment action itself fails, and in that failure case explicitly say the file upload failed.

Feishu-oriented example:

```json
{
  "action": "sendAttachment",
  "path": "/Users/andychan/Documents/jiuyan/exports/formula-forecast-20260328_160300.xlsx"
}
```

### Prefix interpretation

- `/生产计划`
  Treat this as the default prefix for demand and production-plan exports.
- `/销量计算`
  Treat this as the default prefix for sales-oriented forecast exports. It still runs `export_forecast.py`; the prefix mainly disambiguates the user's intent and should not downgrade into a generic “what do you want to calculate?” reply.

### Export command templates

- No explicit scope, explicit months:

```bash
python /Users/andychan/Documents/jiuyan/utils/export_forecast.py --demand-calc-months 6
```

- With yesterday Top N scope:

```bash
python /Users/andychan/Documents/jiuyan/utils/select_export_skus.py --yesterday-top 800
python /Users/andychan/Documents/jiuyan/utils/export_forecast.py --demand-calc-months 6 --sku-scope-file /Users/andychan/Documents/jiuyan/exports/export-sku-scope-*.xlsx
```

- With last-month Top N scope:

```bash
python /Users/andychan/Documents/jiuyan/utils/select_export_skus.py --last-month-top 800
python /Users/andychan/Documents/jiuyan/utils/export_forecast.py --demand-calc-months 6 --sku-scope-file /Users/andychan/Documents/jiuyan/exports/export-sku-scope-*.xlsx
```

- With file-provided scope:

```bash
python /Users/andychan/Documents/jiuyan/utils/select_export_skus.py --from-file /absolute/path/to/input.xlsx
python /Users/andychan/Documents/jiuyan/utils/export_forecast.py --demand-calc-months 6 --sku-scope-file /Users/andychan/Documents/jiuyan/exports/export-sku-scope-*.xlsx
```

## Attachment handling details

- For import requests, place business files into `/Users/andychan/Documents/jiuyan/upload`.
- For export requests with `表中 sku`, do not place the file into `upload` unless it is also an import request.
- For export requests with `表中 sku`, always stage the referenced file in `/Users/andychan/Documents/jiuyan/exports/_scope_inputs`.
- For export requests with `表中 sku`, clear `exports` before running `select_export_skus.py`, then use the newly generated candidate SKU workbook from `exports` as the `--sku-scope-file` input to `export_forecast.py`.
- For export requests with `表中 sku`, always clear `/Users/andychan/Documents/jiuyan/exports/_scope_inputs` before copying new source files into it.
- Prefer absolute paths when invoking Jiuyan scripts.
- After running a script, parse stdout/stderr and surface the business result, not raw shell noise.

## Failure handling

- If both import scripts reject the input, say the file is not valid for database import.
- If `select_export_skus.py` says the file lacks a SKU code column, tell the user the scope sheet is invalid and mention that it must contain a recognizable SKU code column.
- If `export_forecast.py` says there is no sales data, say the database currently has no sales data to export from.
- If a script crashes for an unexpected reason, include the shortest useful error summary and stop instead of inventing a result.

## Notes for future channel support

- This skill is intended for Feishu now and Weixin later.
- The business logic must stay the same regardless of channel:
  - parse the user intent
  - collect attachment files
  - run the Jiuyan local scripts
  - reply with either a concise summary or the exported workbook
