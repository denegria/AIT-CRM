#!/usr/bin/env python3

from __future__ import annotations

import json
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
import xml.etree.ElementTree as ET

DEFAULT_WORKBOOK = "/root/.openclaw/media/inbound/AiT_15_SIGNS_WORK-ESTIMATES---adcfba27-3c56-4bec-99ab-b5e05165f79d.xlsx"
OUT_PATH = Path("docs/ait-signs-data-profile.md")

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def col_to_number(col: str) -> int:
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch.upper()) - 64)
    return n


def ref_to_position(ref: str) -> tuple[int, int] | None:
    col = ""
    row = ""
    for ch in ref:
        if ch.isalpha():
            col += ch
        elif ch.isdigit():
            row += ch
    if not col or not row:
        return None
    return col_to_number(col), int(row)


def text_of(node: ET.Element | None) -> str:
    if node is None:
        return ""
    parts = []
    for text in node.itertext():
        parts.append(text)
    return "".join(parts)


def load_xml(zf: zipfile.ZipFile, name: str) -> ET.Element:
    with zf.open(name) as fh:
        return ET.fromstring(fh.read())


def parse_shared_strings(root: ET.Element) -> list[str]:
    values: list[str] = []
    for si in root.findall("main:si", NS):
        values.append(text_of(si))
    return values


def parse_workbook(zf: zipfile.ZipFile) -> list[dict[str, str]]:
    workbook = load_xml(zf, "xl/workbook.xml")
    rels = load_xml(zf, "xl/_rels/workbook.xml.rels")
    rel_targets = {}
    for rel in rels.findall("rel:Relationship", NS):
        rel_targets[rel.attrib["Id"]] = rel.attrib["Target"]
    sheets = []
    for sheet in workbook.findall("main:sheets/main:sheet", NS):
        sheets.append(
            {
                "name": sheet.attrib["name"],
                "relId": sheet.attrib[f"{{{NS['r']}}}id"],
                "target": rel_targets.get(sheet.attrib[f"{{{NS['r']}}}id"], ""),
            }
        )
    return sheets


def cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t", "n")
    if cell_type == "inlineStr":
        return text_of(cell.find("main:is", NS))
    if cell_type == "s":
        v = cell.findtext("main:v", default="", namespaces=NS)
        if v.isdigit():
            idx = int(v)
            if 0 <= idx < len(shared_strings):
                return shared_strings[idx]
        return ""
    if cell_type == "b":
        v = cell.findtext("main:v", default="", namespaces=NS)
        return "TRUE" if v == "1" else "FALSE"
    v = cell.findtext("main:v", default="", namespaces=NS)
    if v is not None:
        return v
    return text_of(cell.find("main:f", NS))


def parse_sheet(zf: zipfile.ZipFile, target: str, shared_strings: list[str]) -> dict:
    root = load_xml(zf, f"xl/{target}")
    dimension = root.find("main:dimension", NS)
    rows = []
    for row in root.findall("main:sheetData/main:row", NS):
        row_number = int(row.attrib.get("r", "0"))
        dense: dict[int, str] = defaultdict(str)
        for cell in row.findall("main:c", NS):
            ref = cell.attrib.get("r")
            if not ref:
                continue
            pos = ref_to_position(ref)
            if not pos:
                continue
            col_index, _ = pos
            dense[col_index] = cell_value(cell, shared_strings)
        max_col = max(dense.keys(), default=0)
        values = [dense.get(i, "") for i in range(1, max_col + 1)]
        rows.append({"rowNumber": row_number, "dense": values})
    return {
        "dimension": dimension.attrib.get("ref") if dimension is not None else None,
        "rows": rows,
    }


def non_empty_count(values: list[str]) -> int:
    return sum(1 for v in values if str(v).strip())


def find_header_row(rows: list[dict]) -> dict | None:
    keywords = [
        "customer",
        "contacto",
        "phone",
        "fecha",
        "status",
        "observaciones",
        "trabajo",
        "activo",
        "monto",
        "balance",
    ]
    best = None
    for row in rows:
        dense = row["dense"]
        joined = " | ".join(dense).lower()
        score = sum(1 for key in keywords if key in joined)
        if not best or score > best["score"]:
            best = {"rowNumber": row["rowNumber"], "score": score, "dense": dense}
    return best if best and best["score"] else None


def infer_type(name: str, all_text: str) -> str:
    lower_name = name.lower()
    lower = all_text.lower()
    if "terminados" in lower_name or "pagados" in lower_name:
        return "completed_paid"
    if "interesados" in lower_name:
        return "prospects"
    if "estimados" in lower_name:
        return "estimates"
    if "work order" in lower_name:
        return "work_orders"
    if "interesados" in lower:
        return "prospects"
    if "estimados" in lower:
        return "estimates"
    if "terminados" in lower or "pagado" in lower:
        return "completed_paid"
    if "work order" in lower:
        return "work_orders"
    return "mixed"


def summarize_sheet(name: str, sheet_data: dict) -> dict:
    dense_rows = sheet_data["rows"]
    non_empty_rows = [row for row in dense_rows if non_empty_count(row["dense"]) > 0]
    max_cols = max((len(row["dense"]) for row in non_empty_rows), default=0)
    header = find_header_row(dense_rows)
    all_text = " || ".join(
        value.strip()
        for row in non_empty_rows
        for value in row["dense"]
        if value.strip()
    )
    sample_rows = [row["dense"] for row in non_empty_rows[:12]]
    return {
        "name": name,
        "dimension": sheet_data["dimension"],
        "rowCount": len(dense_rows),
        "nonEmptyRowCount": len(non_empty_rows),
        "maxCols": max_cols,
        "headerRow": header["rowNumber"] if header else None,
        "headerScore": header["score"] if header else 0,
        "typeGuess": infer_type(name, all_text),
        "sampleRows": sample_rows,
    }


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
    workbook_file = Path(workbook_path)
    if not workbook_file.exists():
        print(f"Workbook not found: {workbook_path}", file=sys.stderr)
        return 1

    with zipfile.ZipFile(workbook_file) as zf:
        workbook = parse_workbook(zf)
        shared_strings = parse_shared_strings(load_xml(zf, "xl/sharedStrings.xml"))
        sheets = []
        for sheet in workbook:
            parsed = parse_sheet(zf, sheet["target"], shared_strings)
            sheets.append(summarize_sheet(sheet["name"], parsed))

    report = {"workbookPath": str(workbook_file), "sheets": sheets}
    markdown = render_markdown(report)
    print(json.dumps(report, indent=2))
    print("\n--- markdown ---\n")
    print(markdown)
    if write_doc:
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUT_PATH.write_text(markdown + "\n", encoding="utf-8")
        print(f"\nWrote {OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
