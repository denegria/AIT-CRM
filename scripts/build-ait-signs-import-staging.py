#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
from pathlib import Path

from ait_signs_xlsx import DEFAULT_WORKBOOK, build_staging_artifact, load_workbook_profile

JSON_OUT_PATH = Path("docs/ait-signs-import-staging.json")
MD_OUT_PATH = Path("docs/ait-signs-import-staging.md")


def render_markdown(payload: dict) -> str:
    lines: list[str] = []
    lines.append("# AIT Signs import staging")
    lines.append("")
    lines.append(f"Workbook: `{payload['workbookPath']}`")
    lines.append(f"Hash: `{payload['workbookFileHash']}`")
    lines.append("")
    lines.append("## Counts")
    lines.append("")
    lines.append(f"- source rows: {payload['counts']['sourceRows']}")
    lines.append(f"- normalized records: {payload['counts']['normalizedRecords']}")
    lines.append(f"- review items: {payload['counts']['reviewItems']}")
    lines.append("")
    lines.append("## Sheet breakdown")
    lines.append("")
    for sheet in payload["sheets"]:
        lines.append(
            f"- {sheet['name']}: {sheet['family']} / {sheet['sourceType']}, "
            f"{sheet['nonEmptyRowCount']}/{sheet['rowCount']} non-empty rows, "
            f"header row {sheet['headerRow'] if sheet['headerRow'] is not None else 'none'}"
        )
    lines.append("")
    lines.append("## Normalized record samples")
    lines.append("")
    for record in payload["normalizedRecords"][:8]:
        proposed = (
            record.get("proposedLeadJson")
            or record.get("proposedEstimateJson")
            or record.get("proposedWorkOrderJson")
            or record.get("proposedPaymentJson")
            or record.get("proposedNoteJson")
            or {}
        )
        lines.append(
            f"- {record['recordType']} {record['sourceSheet']} #{record['sourceRowNumber']}: "
            f"{proposed.get('originalText', '')}"
        )
    lines.append("")
    lines.append("## Review samples")
    lines.append("")
    for item in payload["reviewItems"][:8]:
        lines.append(
            f"- {item['reviewType']} {item['sourceSheet']} #{item['sourceRowNumber']}: {item['reason']}"
        )
    lines.append("")
    lines.append("## Use")
    lines.append("")
    lines.append("This artifact is the first staging boundary for MIS-12.")
    lines.append("")
    lines.append("- raw source rows stay immutable")
    lines.append("- normalized records stay reviewable before production writes")
    lines.append("- low-confidence rows are routed to manual review")
    return "\n".join(lines)


def main() -> int:
    workbook_path = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else DEFAULT_WORKBOOK
    write_docs = "--write-docs" in sys.argv
    report = load_workbook_profile(workbook_path)
    payload = build_staging_artifact(report, workbook_path)
    if write_docs:
        JSON_OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        JSON_OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        MD_OUT_PATH.write_text(render_markdown(payload) + "\n", encoding="utf-8")
        print(f"\nWrote {JSON_OUT_PATH}")
        print(f"Wrote {MD_OUT_PATH}")
    else:
        print(json.dumps(payload, indent=2))
    print(
        json.dumps(
            {
                "sourceRows": payload["counts"]["sourceRows"],
                "normalizedRecords": payload["counts"]["normalizedRecords"],
                "reviewItems": payload["counts"]["reviewItems"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
