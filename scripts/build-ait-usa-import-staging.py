#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
from pathlib import Path

from ait_usa_xlsx import DEFAULT_WORKBOOK, build_staging_artifact, load_workbook_profile

JSON_OUT_PATH = Path("docs/ait-usa-import-staging.json")
MD_OUT_PATH = Path("docs/ait-usa-import-staging.md")


def render_markdown(payload: dict) -> str:
    lines = [
        "# AIT USA import staging",
        "",
        f"Workbook: `{payload['workbookPath']}`",
        f"Hash: `{payload['workbookFileHash']}`",
        f"Business unit: `{payload['businessUnit']}`",
        "",
        "## Counts",
        "",
        f"- source rows: {payload['counts']['sourceRows']}",
        f"- lead records: {payload['counts']['leadRecords']}",
        f"- activity events: {payload['counts']['activityEventRecords']}",
        f"- duplicate activity events skipped: {payload['counts']['duplicateActivityEventsSkipped']}",
        f"- review items: {payload['counts']['reviewItems']}",
        "",
        "## Primary sheet breakdown",
        "",
    ]
    for sheet_name, counts in payload["sheetCounts"].items():
        lines.append(
            f"- {sheet_name}: {counts['sourceRows']} source rows, "
            f"{counts['parsedRows']} parsed, {counts['needsReviewRows']} needs review"
        )
    lines.extend(["", "## Privacy", ""])
    lines.append("The JSON artifact contains source workbook row data and should stay out of git.")
    lines.append("This Markdown summary intentionally omits lead names, phone numbers, and message text.")
    lines.extend(
        [
            "",
            "## Use",
            "",
            "This artifact stages AIT USA lead/contact proposals and imported follow-up activity events.",
            "",
            "- phone-bearing rows become one lead/contact proposal per normalized phone",
            "- continuation rows attach follow-up events to the active prior phone on that sheet",
            "- exact copied follow-up events are skipped before staging",
            "- this script does not promote records to production CRM entities",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    workbook_path = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else DEFAULT_WORKBOOK
    write_docs = "--write-docs" in sys.argv
    report = load_workbook_profile(workbook_path)
    payload = build_staging_artifact(report, workbook_path)
    if write_docs:
        JSON_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        JSON_OUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        MD_OUT_PATH.write_text(render_markdown(payload) + "\n", encoding="utf-8")
        print(f"Wrote {JSON_OUT_PATH}")
        print(f"Wrote {MD_OUT_PATH}")
    else:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    print(json.dumps(payload["counts"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
