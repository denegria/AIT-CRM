#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
from pathlib import Path

from ait_signs_xlsx import DEFAULT_WORKBOOK, load_workbook_profile

OUT_PATH = Path("docs/ait-signs-data-profile.md")


def render_markdown(report: dict) -> str:
    lines = []
    lines.append("# AIT Signs workbook profile")
    lines.append("")
    lines.append(f"Workbook: `{report['workbookPath']}`")
    lines.append("")
    lines.append("## Sheet summary")
    lines.append("")
    for sheet in report["sheets"]:
        header = sheet["headerRow"] if sheet["headerRow"] is not None else "none"
        lines.append(
            f"- {sheet['name']}: {sheet['typeGuess']}, {sheet['nonEmptyRowCount']}/{sheet['rowCount']} non-empty rows, max {sheet['maxCols']} cols, header row {header}"
        )
    lines.append("")
    lines.append("## Heuristic notes")
    lines.append("")
    lines.append("- The workbook contains multiple lifecycle tabs rather than one flat table.")
    lines.append("- Spanish notes, status legends, balances, and follow-up notes are mixed into the same source rows.")
    lines.append("- A read-only staging/import pipeline is required before any production import.")
    lines.append("")
    lines.append("## Sample rows")
    lines.append("")
    for sheet in report["sheets"]:
        lines.append(f"### {sheet['name']}")
        for row in sheet["sampleRows"][:5]:
            lines.append(f"- {' | '.join(v for v in row if v and v.strip())}")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    workbook_path = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else DEFAULT_WORKBOOK
    write_doc = "--write-doc" in sys.argv
    report = load_workbook_profile(workbook_path)
    markdown = render_markdown(report)
    print(json.dumps({"workbookPath": report["workbookPath"], "sheets": report["sheets"]}, indent=2))
    print("\n--- markdown ---\n")
    print(markdown)
    if write_doc:
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUT_PATH.write_text(markdown + "\n", encoding="utf-8")
        print(f"\nWrote {OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
