#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
from pathlib import Path

from ait_signs_xlsx import DEFAULT_WORKBOOK, load_workbook_profile

OUT_PATH = Path("docs/ait-signs-staging-preview.json")


def summarize_row(row: dict) -> dict:
    values = row["values"]
    non_empty = [v.strip() for v in values if str(v).strip()]
    return {
        "sheet": row["sheet"],
        "rowNumber": row["rowNumber"],
        "kind": row["kind"],
        "confidence": row["confidence"],
        "summary": row["summary"],
        "fieldCount": len(values),
        "nonEmptyCount": len(non_empty),
        "values": values,
    }


def main() -> int:
    workbook_path = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else DEFAULT_WORKBOOK
    write_doc = "--write-doc" in sys.argv
    report = load_workbook_profile(workbook_path)
    rows = [summarize_row(row) for row in report["rowInventory"]]
    payload = {
        "workbookPath": report["workbookPath"],
        "rowCount": len(rows),
        "rows": rows,
    }
    print(json.dumps(payload, indent=2))
    if write_doc:
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"\nWrote {OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
