from __future__ import annotations

import hashlib
import re
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

DEFAULT_WORKBOOK = "/root/.openclaw/giuseppe-workspace/tmp/ait-usa-profile/AiTUSA.SEGUIMIENTO.CENTRAL.xlsx"
BUSINESS_UNIT = "AIT USA Institute"

PRIMARY_SHEETS = ("2023 Y ANTERIORES", "2024", "ENE A MAY 2025", "2025")
SHEET_ORDER = {name: index for index, name in enumerate(PRIMARY_SHEETS)}

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}

PHONE_RE = re.compile(r"\d+")


def col_to_number(col: str) -> int:
    value = 0
    for char in col.upper():
        value = value * 26 + (ord(char) - 64)
    return value


COLS = {
    "call": col_to_number("D"),
    "owner": col_to_number("E"),
    "lead_date": col_to_number("F"),
    "name": col_to_number("G"),
    "phone": col_to_number("I"),
    "location": col_to_number("J"),
    "email": col_to_number("K"),
    "service": col_to_number("L"),
    "details": col_to_number("M"),
    "day": col_to_number("N"),
    "schedule": col_to_number("O"),
    "test": col_to_number("P"),
    "level": col_to_number("Q"),
    "school": col_to_number("R"),
    "source": col_to_number("S"),
    "follow_date_1": col_to_number("V"),
    "follow_owner_1": col_to_number("W"),
    "follow_time_1": col_to_number("X"),
    "follow_message_1": col_to_number("Y"),
    "follow_date_2": col_to_number("AA"),
    "follow_owner_2": col_to_number("AB"),
    "follow_time_2": col_to_number("AC"),
    "follow_message_2": col_to_number("AD"),
}


def normalize_text(value: object) -> str:
    return " ".join(str(value or "").strip().split())


def canonical_sheet_name(value: object) -> str:
    text = normalize_text(value)
    if text == "2023 Y ANTERIORES":
        return "2023 Y ANTERIORES"
    return text


def normalized_lower(value: object) -> str:
    return normalize_text(value).casefold()


def row_text(values: list[str]) -> str:
    return " | ".join(normalize_text(value) for value in values if normalize_text(value))


def cell_at(values: list[str], column_number: int) -> str:
    index = column_number - 1
    if index < 0 or index >= len(values):
        return ""
    return normalize_text(values[index])


def normalize_phone(value: object) -> str | None:
    digits = "".join(PHONE_RE.findall(str(value or "")))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) >= 10:
        return digits[-10:]
    return None


def parse_excel_date(value: object) -> str | None:
    text = normalize_text(value)
    if not text:
        return None
    try:
        serial = float(text)
    except ValueError:
        return text if re.match(r"^\d{4}-\d{2}-\d{2}", text) else None
    if serial < 20000 or serial > 60000:
        return None
    return (datetime(1899, 12, 30) + timedelta(days=serial)).date().isoformat()


def parse_occurred_at(date_value: object, time_value: object = "") -> str | None:
    date_part = parse_excel_date(date_value)
    if not date_part:
        return None
    time_text = normalize_text(time_value)
    if not time_text:
        return f"{date_part}T12:00:00.000Z"
    try:
        fraction = float(time_text)
    except ValueError:
        return f"{date_part}T12:00:00.000Z"
    if 0 <= fraction < 1:
        seconds = round(fraction * 24 * 60 * 60)
        base = datetime.fromisoformat(date_part)
        return (base + timedelta(seconds=seconds)).isoformat(timespec="seconds") + ".000Z"
    return f"{date_part}T12:00:00.000Z"


def text_of(node: ET.Element | None) -> str:
    if node is None:
        return ""
    return "".join(node.itertext())


def load_xml(zf: zipfile.ZipFile, name: str) -> ET.Element:
    with zf.open(name) as fh:
        return ET.fromstring(fh.read())


def parse_shared_strings(root: ET.Element) -> list[str]:
    return [text_of(si) for si in root.findall("main:si", NS)]


def ref_to_position(ref: str) -> tuple[int, int] | None:
    match = re.match(r"^([A-Z]+)(\d+)$", ref)
    if not match:
        return None
    return col_to_number(match.group(1)), int(match.group(2))


def parse_workbook(zf: zipfile.ZipFile) -> list[dict[str, str]]:
    workbook = load_xml(zf, "xl/workbook.xml")
    rels = load_xml(zf, "xl/_rels/workbook.xml.rels")
    rel_targets = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels.findall("rel:Relationship", NS)}
    sheets = []
    for sheet in workbook.findall("main:sheets/main:sheet", NS):
        rid = sheet.attrib[f"{{{NS['r']}}}id"]
        target = rel_targets.get(rid, "")
        sheets.append({"name": sheet.attrib["name"], "target": target})
    return sheets


def cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t", "n")
    if cell_type == "inlineStr":
        return text_of(cell.find("main:is", NS))
    if cell_type == "s":
        value = cell.findtext("main:v", default="", namespaces=NS)
        if value.isdigit() and int(value) < len(shared_strings):
            return shared_strings[int(value)]
        return ""
    return cell.findtext("main:v", default="", namespaces=NS) or ""


def parse_sheet(zf: zipfile.ZipFile, target: str, shared_strings: list[str]) -> dict:
    root = load_xml(zf, f"xl/{target}")
    rows = []
    for row in root.findall("main:sheetData/main:row", NS):
        row_number = int(row.attrib.get("r", "0"))
        dense: dict[int, str] = defaultdict(str)
        for cell in row.findall("main:c", NS):
            position = ref_to_position(cell.attrib.get("r", ""))
            if not position:
                continue
            dense[position[0]] = cell_value(cell, shared_strings)
        max_col = max(dense.keys(), default=0)
        rows.append({"rowNumber": row_number, "dense": [dense.get(i, "") for i in range(1, max_col + 1)]})
    return {"rows": rows}


def load_workbook_profile(workbook_path: str | Path) -> dict:
    workbook_file = Path(workbook_path)
    with zipfile.ZipFile(workbook_file) as zf:
        workbook = parse_workbook(zf)
        shared_strings = parse_shared_strings(load_xml(zf, "xl/sharedStrings.xml"))
        sheets = []
        row_inventory = []
        for sheet in workbook:
            sheet_name = canonical_sheet_name(sheet["name"])
            target = sheet["target"]
            if not target.startswith("worksheets/"):
                target = f"worksheets/{Path(target).name}"
            parsed = parse_sheet(zf, target, shared_strings)
            non_empty_rows = [row for row in parsed["rows"] if row_text(row["dense"])]
            sheets.append(
                {
                    "name": sheet_name,
                    "sourceName": sheet["name"],
                    "rowCount": len(parsed["rows"]),
                    "nonEmptyRowCount": len(non_empty_rows),
                    "maxCols": max((len(row["dense"]) for row in non_empty_rows), default=0),
                    "isPrimary": sheet_name in PRIMARY_SHEETS,
                    "headerRow": 9 if sheet_name in PRIMARY_SHEETS else None,
                }
            )
            for row in parsed["rows"]:
                row_inventory.append({"sheet": sheet_name, "rowNumber": row["rowNumber"], "values": row["dense"]})
    return {"workbookPath": str(workbook_file), "sheets": sheets, "rowInventory": row_inventory}


def lead_status(values: list[str]) -> str:
    text = normalized_lower(row_text(values))
    if any(marker in text for marker in ("ya no llamar", "no llamar", "no quiere", "no interesa", "no interesado")):
        return "Lost"
    if any(marker in text for marker in ("numero malo", "número malo", "fuera de servicio", "error", "wrong")):
        return "Lost"
    if any(marker in text for marker in ("concretado", "inscrito", "vino", "promete venir")):
        return "Qualified"
    if any(marker in text for marker in ("llamar", "contact", "seguimiento", "whatsapp")):
        return "Contacted"
    return "New Lead"


def lead_proposal(sheet: str, row_number: int, values: list[str], phone: str) -> dict:
    name = cell_at(values, COLS["name"])
    service = cell_at(values, COLS["service"])
    detail = cell_at(values, COLS["details"])
    return {
        "businessUnit": BUSINESS_UNIT,
        "sourceType": "ait_usa_xlsx",
        "sourceName": "AIT USA Seguimiento Central",
        "sourceSheet": sheet,
        "sourceRowNumber": row_number,
        "contactHint": name or "Unknown AIT USA Lead",
        "phoneHint": phone,
        "emailHint": cell_at(values, COLS["email"]) or None,
        "locationHint": cell_at(values, COLS["location"]) or None,
        "desiredService": service or None,
        "detailText": detail or None,
        "ownerHint": cell_at(values, COLS["owner"]) or None,
        "sourceLabel": cell_at(values, COLS["source"]) or None,
        "leadDate": parse_excel_date(cell_at(values, COLS["lead_date"])),
        "statusHint": lead_status(values),
        "originalText": row_text(values),
        "rawValuesJson": values,
    }


def follow_up_blocks(values: list[str]) -> list[dict]:
    blocks = []
    for index in ("1", "2"):
        message = cell_at(values, COLS[f"follow_message_{index}"])
        if not message:
            continue
        blocks.append(
            {
                "message": message,
                "date": cell_at(values, COLS[f"follow_date_{index}"]),
                "owner": cell_at(values, COLS[f"follow_owner_{index}"]),
                "time": cell_at(values, COLS[f"follow_time_{index}"]),
            }
        )
    return blocks


def event_key(phone: str, block: dict) -> tuple[str, str, str, str, str]:
    return (
        phone,
        parse_excel_date(block.get("date")) or normalize_text(block.get("date")),
        normalized_lower(block.get("owner")),
        normalize_text(block.get("time")),
        normalized_lower(block.get("message")),
    )


def event_proposal(sheet: str, row_number: int, values: list[str], phone: str, block: dict) -> dict:
    return {
        "businessUnit": BUSINESS_UNIT,
        "sourceType": "ait_usa_xlsx",
        "sourceName": "AIT USA Seguimiento Central",
        "sourceSheet": sheet,
        "sourceRowNumber": row_number,
        "recordType": "activity_event",
        "eventType": "ait_usa.follow_up",
        "phoneHint": phone,
        "message": block["message"],
        "actorHint": block.get("owner") or None,
        "occurredAt": parse_occurred_at(block.get("date"), block.get("time")),
        "eventDate": parse_excel_date(block.get("date")) or None,
        "eventTimeHint": block.get("time") or None,
        "originalText": row_text(values),
        "rawValuesJson": values,
    }


def row_sort_key(row: dict) -> tuple[int, int]:
    return (SHEET_ORDER.get(row["sheet"], 999), row["rowNumber"])


def should_ignore_primary_row(row_number: int, values: list[str]) -> bool:
    if row_number <= 9:
        return True
    text = normalized_lower(row_text(values))
    if not text:
        return True
    return text.startswith("aqui empieza") or text.startswith("aquí empieza")


def build_staging_artifact(report: dict, workbook_path: str | Path) -> dict:
    workbook_file = Path(workbook_path)
    file_hash = hashlib.sha256(workbook_file.read_bytes()).hexdigest()
    generated_at = datetime.now(timezone.utc).isoformat()

    source_rows = []
    lead_candidates: dict[str, dict] = {}
    event_records = []
    seen_event_keys = set()
    active_phone_by_sheet: dict[str, str] = {}
    duplicate_events = 0
    unlinked_event_rows = 0

    primary_rows = sorted(
        (row for row in report["rowInventory"] if row["sheet"] in PRIMARY_SHEETS),
        key=row_sort_key,
    )

    for row in primary_rows:
        sheet = row["sheet"]
        row_number = row["rowNumber"]
        values = row["values"]
        raw_text = row_text(values)
        ignored = should_ignore_primary_row(row_number, values)
        phone = normalize_phone(cell_at(values, COLS["phone"]))
        blocks = follow_up_blocks(values)
        parse_status = "ignored" if ignored else "needs_review"

        if phone:
            active_phone_by_sheet[sheet] = phone
            candidate = lead_proposal(sheet, row_number, values, phone)
            existing = lead_candidates.get(phone)
            if not existing or row_sort_key({"sheet": sheet, "rowNumber": row_number}) >= row_sort_key(existing["source"]):
                lead_candidates[phone] = {"source": {"sheet": sheet, "rowNumber": row_number}, "proposal": candidate}
            parse_status = "parsed"

        event_phone = phone or active_phone_by_sheet.get(sheet)
        if blocks and event_phone:
            parse_status = "parsed"
            for block in blocks:
                key = event_key(event_phone, block)
                if key in seen_event_keys:
                    duplicate_events += 1
                    continue
                seen_event_keys.add(key)
                proposal = event_proposal(sheet, row_number, values, event_phone, block)
                event_records.append(
                    {
                        "sourceSheet": sheet,
                        "sourceRowNumber": row_number,
                        "recordType": "activity_event",
                        "confidenceScore": 0.86 if phone else 0.78,
                        "status": "pending",
                        "proposedNoteJson": proposal,
                    }
                )
        elif blocks and not event_phone:
            unlinked_event_rows += 1

        source_rows.append(
            {
                "sheet": sheet,
                "sourceSheet": sheet,
                "sourceRowNumber": row_number,
                "rowKind": "lead_or_follow_up" if parse_status == "parsed" else "ignored" if ignored else "unlinked_text",
                "parseStatus": parse_status,
                "rawValuesJson": values,
                "rawText": raw_text,
            }
        )

    lead_records = []
    for phone, candidate in sorted(lead_candidates.items()):
        proposal = candidate["proposal"]
        lead_records.append(
            {
                "sourceSheet": proposal["sourceSheet"],
                "sourceRowNumber": proposal["sourceRowNumber"],
                "recordType": "lead",
                "confidenceScore": 0.9,
                "status": "pending",
                "proposedContactJson": {
                    "businessUnit": BUSINESS_UNIT,
                    "name": proposal["contactHint"],
                    "phone": phone,
                    "email": proposal.get("emailHint"),
                    "sourceLabel": proposal.get("sourceLabel") or "AIT USA Seguimiento Central",
                    "sourceSheet": proposal["sourceSheet"],
                    "sourceRowNumber": proposal["sourceRowNumber"],
                },
                "proposedLeadJson": proposal,
            }
        )

    sheet_summaries = []
    for sheet in report["sheets"]:
        sheet_summaries.append(
            {
                "name": sheet["name"],
                "isPrimary": sheet["isPrimary"],
                "rowCount": sheet["rowCount"],
                "nonEmptyRowCount": sheet["nonEmptyRowCount"],
                "headerRow": sheet["headerRow"],
                "maxCols": sheet["maxCols"],
            }
        )

    normalized_records = lead_records + event_records
    sheet_counts = {}
    for row in source_rows:
        stats = sheet_counts.setdefault(row["sourceSheet"], {"sourceRows": 0, "parsedRows": 0, "needsReviewRows": 0})
        stats["sourceRows"] += 1
        if row["parseStatus"] == "parsed":
            stats["parsedRows"] += 1
        elif row["parseStatus"] == "needs_review":
            stats["needsReviewRows"] += 1

    review_items = [
        {
            "sourceSheet": row["sourceSheet"],
            "sourceRowNumber": row["sourceRowNumber"],
            "reviewType": row["rowKind"],
            "reason": row["rawText"][:240],
            "reviewStatus": "pending",
            "proposedResolutionJson": {
                "businessUnit": BUSINESS_UNIT,
                "sourceType": "ait_usa_xlsx",
                "sourceSheet": row["sourceSheet"],
                "sourceRowNumber": row["sourceRowNumber"],
            },
        }
        for row in source_rows
        if row["parseStatus"] == "needs_review"
    ]

    return {
        "generatedAt": generated_at,
        "workbookPath": str(workbook_file),
        "workbookFileHash": file_hash,
        "sourceName": "AIT USA Seguimiento Central",
        "sourceType": "ait_usa_xlsx",
        "businessUnit": BUSINESS_UNIT,
        "sheets": sheet_summaries,
        "sheetCounts": sheet_counts,
        "counts": {
            "sourceRows": len(source_rows),
            "normalizedRecords": len(normalized_records),
            "leadRecords": len(lead_records),
            "activityEventRecords": len(event_records),
            "reviewItems": len(review_items),
            "duplicateActivityEventsSkipped": duplicate_events,
            "unlinkedEventRows": unlinked_event_rows,
        },
        "sourceRows": source_rows,
        "normalizedRecords": normalized_records,
        "reviewItems": review_items,
    }
