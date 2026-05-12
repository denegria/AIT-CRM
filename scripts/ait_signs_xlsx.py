from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

DEFAULT_WORKBOOK = "/root/.openclaw/media/inbound/AiT_15_SIGNS_WORK-ESTIMATES---adcfba27-3c56-4bec-99ab-b5e05165f79d.xlsx"

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
    return "".join(node.itertext())


def load_xml(zf: zipfile.ZipFile, name: str) -> ET.Element:
    with zf.open(name) as fh:
        return ET.fromstring(fh.read())


def parse_shared_strings(root: ET.Element) -> list[str]:
    return [text_of(si) for si in root.findall("main:si", NS)]


def parse_workbook(zf: zipfile.ZipFile) -> list[dict[str, str]]:
    workbook = load_xml(zf, "xl/workbook.xml")
    rels = load_xml(zf, "xl/_rels/workbook.xml.rels")
    rel_targets = {}
    for rel in rels.findall("rel:Relationship", NS):
        rel_targets[rel.attrib["Id"]] = rel.attrib["Target"]
    sheets = []
    for sheet in workbook.findall("main:sheets/main:sheet", NS):
        rid = sheet.attrib[f"{{{NS['r']}}}id"]
        sheets.append(
            {
                "name": sheet.attrib["name"],
                "relId": rid,
                "target": rel_targets.get(rid, ""),
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


def classify_row(sheet_name: str, row_number: int, values: list[str]) -> dict:
    non_empty = [v.strip() for v in values if str(v).strip()]
    joined = " | ".join(non_empty)
    lower = joined.lower()
    if not non_empty:
        return {
            "sheet": sheet_name,
            "rowNumber": row_number,
            "kind": "blank",
            "confidence": 1.0,
            "summary": "",
            "values": values,
        }

    section_markers = [
        "prospectos o interesados",
        "15 work order",
        "work order - central",
        "work order terminados",
        "estimados",
    ]
    if any(marker in lower for marker in section_markers):
        return {
            "sheet": sheet_name,
            "rowNumber": row_number,
            "kind": "section_header",
            "confidence": 0.9,
            "summary": joined,
            "values": values,
        }

    header_markers = [
        "customer",
        "contacto",
        "phone",
        "status",
        "observaciones",
        "monto",
        "balance",
        "actual status",
        "neto",
        "total.vta",
    ]
    if sum(1 for marker in header_markers if marker in lower) >= 4:
        return {
            "sheet": sheet_name,
            "rowNumber": row_number,
            "kind": "header",
            "confidence": 0.95,
            "summary": joined,
            "values": values,
        }

    has_phone = any(ch.isdigit() for ch in joined) and any(len(token) >= 7 for token in joined.split())
    has_name = any(token.isalpha() for token in non_empty)
    has_money = any(token.replace(".", "", 1).isdigit() for token in non_empty)
    has_note = any(marker in lower for marker in ["llamar", "contesto", "contact", "pago", "entregado", "seguimiento", "no contest", "volver"])

    if has_phone and (has_name or has_note):
        kind = "record_candidate"
        confidence = 0.72
    elif has_note:
        kind = "note"
        confidence = 0.66
    elif has_money:
        kind = "financial_line"
        confidence = 0.62
    else:
        kind = "misc_text"
        confidence = 0.4

    return {
        "sheet": sheet_name,
        "rowNumber": row_number,
        "kind": kind,
        "confidence": confidence,
        "summary": joined[:240],
        "values": values,
    }


def load_workbook_profile(workbook_path: str | Path) -> dict:
    workbook_file = Path(workbook_path)
    with zipfile.ZipFile(workbook_file) as zf:
        workbook = parse_workbook(zf)
        shared_strings = parse_shared_strings(load_xml(zf, "xl/sharedStrings.xml"))
        sheets = []
        row_inventory = []
        for sheet in workbook:
            parsed = parse_sheet(zf, sheet["target"], shared_strings)
            sheets.append(summarize_sheet(sheet["name"], parsed))
            for row in parsed["rows"]:
                row_inventory.append(classify_row(sheet["name"], row["rowNumber"], row["dense"]))
    return {
        "workbookPath": str(workbook_file),
        "sheets": sheets,
        "rowInventory": row_inventory,
    }
