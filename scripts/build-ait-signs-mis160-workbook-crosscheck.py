#!/usr/bin/env python3

from __future__ import annotations

import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

from ait_signs_xlsx import DEFAULT_WORKBOOK, load_workbook_profile

WORKBOOK_CANDIDATES = [
    "/root/.openclaw/giuseppe-workspace/tmp/ait-usa-profile/AiT.15.SIGNS.WORK-ESTIMATES.1.xlsx",
    DEFAULT_WORKBOOK,
]
FINANCIAL_INPUT = Path("docs/mis-160-ait-signs-financial-line-review.json")
CONTEXT_INPUT = Path("docs/mis-160-ait-signs-follow-up-context-review.json")
OUTPUT_BASE = Path("docs/mis-160-ait-signs-workbook-crosscheck")

PHONE_RE = re.compile(r"(?<!\d)(?:\+?\d[\d\s().-]{5,}\d)(?!\d)")
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)


def clean(value: object) -> str:
    return " ".join(str(value or "").strip().split())


def compact_values(values: list[str]) -> list[str]:
    return [clean(value) for value in values if clean(value)]


def row_text(row: dict | None) -> str:
    if not row:
        return ""
    return " | ".join(compact_values(row.get("values", [])))


def phone_values(text: str) -> list[str]:
    phones = []
    for match in PHONE_RE.finditer(text):
        digits = re.sub(r"\D", "", match.group(0))
        if len(digits) == 10 or (len(digits) == 11 and digits.startswith("1")):
            phones.append(digits[-10:])
    return sorted(set(phones))


def email_values(text: str) -> list[str]:
    return sorted(set(match.group(0).lower() for match in EMAIL_RE.finditer(text)))


def cell(values: list[str], column_number: int) -> str:
    index = column_number - 1
    if index < 0 or index >= len(values):
        return ""
    return clean(values[index])


def original_identity_fields(row: dict | None) -> dict[str, str]:
    if not row:
        return {}
    values = row.get("values", [])
    fields = {
        "customer": cell(values, 5),
        "contact": cell(values, 6),
        "phoneColumn": cell(values, 7),
    }
    text = row_text(row)
    phones = phone_values(text)
    emails = email_values(text)
    if phones:
        fields["phones"] = "; ".join(phones)
    if emails:
        fields["emails"] = "; ".join(emails)
    return {key: value for key, value in fields.items() if value}


def is_reject_recommendation(value: str) -> bool:
    return value == "reject_noise" or value.startswith("reject_as_")


def crosscheck_verdict(row: dict, original: dict | None, identity_fields: dict[str, str]) -> str:
    if not original:
        return "blocked_missing_workbook_row"
    if not is_reject_recommendation(row["recommendation"]):
        return "needs_human_or_attach_plan"
    if identity_fields:
        return "reject_blocked_original_row_has_identity_fields"
    return "reject_source_row_has_no_identity_fields"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def workbook_path() -> str:
    for candidate in WORKBOOK_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    raise FileNotFoundError("AIT Signs workbook not found in known locations")


def keyed(sheet: str, row_number: int) -> tuple[str, int]:
    return (sheet, int(row_number))


def build_workbook_index(workbook: str) -> dict[tuple[str, int], dict]:
    profile = load_workbook_profile(workbook)
    return {
        keyed(row["sheet"], row["rowNumber"]): row
        for row in profile["rowInventory"]
    }


def source_rows(report: dict, source: str) -> list[dict]:
    rows = []
    for row in report.get("rows", []):
        rows.append(
            {
                "source": source,
                "recommendation": row.get("recommendation", ""),
                "target": row.get("target", ""),
                "evidence": row.get("evidence", ""),
                "sourceSheet": row.get("sourceSheet", ""),
                "sourceRowNumber": row.get("sourceRowNumber"),
                "reviewType": row.get("reviewType", ""),
                "reason": row.get("reason", ""),
            }
        )
    return rows


def enrich(row: dict, workbook_rows: dict[tuple[str, int], dict]) -> dict:
    sheet = row["sourceSheet"]
    row_number = int(row["sourceRowNumber"])
    original = workbook_rows.get(keyed(sheet, row_number))
    previous_row = workbook_rows.get(keyed(sheet, row_number - 1))
    next_row = workbook_rows.get(keyed(sheet, row_number + 1))
    original_text = row_text(original)
    context_text = " || ".join(part for part in [row_text(previous_row), original_text, row_text(next_row)] if part)
    phones = phone_values(context_text)
    emails = email_values(context_text)
    identity_fields = original_identity_fields(original)
    return {
        **row,
        "workbookRowFound": bool(original),
        "workbookKind": original.get("kind") if original else "",
        "workbookConfidence": original.get("confidence") if original else "",
        "workbookOriginalIdentityFields": identity_fields,
        "workbookOriginalText": original_text,
        "workbookPreviousRowText": row_text(previous_row),
        "workbookNextRowText": row_text(next_row),
        "contextPhones": "; ".join(phones),
        "contextEmails": "; ".join(emails),
        "crosscheckVerdict": crosscheck_verdict(row, original, identity_fields),
    }


def write_csv(path: Path, rows: list[dict]) -> None:
    columns = [
        "source",
        "recommendation",
        "crosscheckVerdict",
        "sourceSheet",
        "sourceRowNumber",
        "reviewType",
        "target",
        "contextPhones",
        "contextEmails",
        "workbookOriginalIdentityFields",
        "evidence",
        "workbookKind",
        "workbookOriginalText",
        "workbookPreviousRowText",
        "workbookNextRowText",
        "reason",
    ]
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    column: json.dumps(row.get(column), sort_keys=True)
                    if column == "workbookOriginalIdentityFields"
                    else row.get(column, "")
                    for column in columns
                }
            )


def render_markdown(report: dict) -> str:
    lines = [
        "# MIS-160 AIT Signs Workbook Cross-check",
        "",
        f"- Workbook: `{report['workbookPath']}`",
        f"- Financial review input: `{FINANCIAL_INPUT}`",
        f"- Follow-up/context review input: `{CONTEXT_INPUT}`",
        "- DB writes: none",
        "",
        "## Summary",
        "",
    ]
    for key, value in report["summary"]["byCrosscheckVerdict"].items():
        lines.append(f"- {key}: {value}")
    lines.extend(
        [
            "",
            "## Recommendation",
            "",
            "- Do not use the old generic reject evidence as the approval gate.",
            "- Use this cross-check CSV for approval: every row is tied back to the original workbook row and immediate neighbor context.",
            "- Keep non-reject recommendations in a separate attach/promote/hold plan.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> int:
    workbook = workbook_path()
    workbook_rows = build_workbook_index(workbook)
    financial = load_json(FINANCIAL_INPUT)
    context = load_json(CONTEXT_INPUT)
    rows = [
        enrich(row, workbook_rows)
        for row in [
            *source_rows(financial, "financial_line_review"),
            *source_rows(context, "follow_up_context_review"),
        ]
    ]
    summary = {
        "total": len(rows),
        "byRecommendation": dict(Counter(row["recommendation"] for row in rows)),
        "byCrosscheckVerdict": dict(Counter(row["crosscheckVerdict"] for row in rows)),
        "missingWorkbookRows": sum(1 for row in rows if not row["workbookRowFound"]),
        "rejectRowsWithContextPhones": sum(
            1
            for row in rows
            if row["crosscheckVerdict"] == "reject_source_row_has_no_identity_fields" and row["contextPhones"]
        ),
        "rejectRowsWithContextEmails": sum(
            1
            for row in rows
            if row["crosscheckVerdict"] == "reject_source_row_has_no_identity_fields" and row["contextEmails"]
        ),
    }
    report = {
        "workbookPath": workbook,
        "summary": summary,
        "rows": rows,
    }
    OUTPUT_BASE.parent.mkdir(parents=True, exist_ok=True)
    (OUTPUT_BASE.with_suffix(".json")).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    write_csv(OUTPUT_BASE.with_suffix(".csv"), rows)
    (OUTPUT_BASE.with_suffix(".md")).write_text(render_markdown(report), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
