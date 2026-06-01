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
HEADER_ROWS = {
    "2023 Y ANTERIORES": 9,
    "2024": 9,
    "ENE A MAY 2025": 9,
    "2025": 10,
}

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}

PHONE_RE = re.compile(r"\d+")
OWNER_MARKERS = {
    "ana maria",
    "andrea",
    "ariana",
    "edna",
    "frank",
    "karla",
    "lili",
    "liliana",
    "liz",
    "nicole",
    "sindy",
    "sofia",
}
NOISE_MARKERS = {"*", ".", ":", "/", "whatsapp", "whataspp"}
MANUAL_PHONE_RESOLUTIONS = {
    ("2023 Y ANTERIORES", 10): {
        "group": "maria-solis-2023",
        "primaryPhone": "7326456593",
        "primaryRecord": True,
        "contactabilityStatus": "reachable",
        "reason": "Primary number has real information-sent follow-up.",
    },
    ("2023 Y ANTERIORES", 925): {
        "group": "maria-solis-2023",
        "primaryPhone": "7326456593",
        "invalidPhone": "7326466593",
        "contactabilityStatus": "wrong_number",
        "reason": "Follow-ups mark this near-match number as no WhatsApp, wrong number, and PBX.",
    },
    ("2023 Y ANTERIORES", 484): {
        "group": "orlando-granados",
        "primaryPhone": "7327053298",
        "alternatePhone": "7325073298",
        "contactabilityStatus": "low_confidence_alternate",
        "reason": "Older sparse row merged into the later row with substantive return-interest follow-up.",
    },
    ("2024", 1928): {
        "group": "orlando-granados",
        "primaryPhone": "7327053298",
        "primaryRecord": True,
        "contactabilityStatus": "reachable",
        "reason": "Follow-up says old student wants to return and a call was scheduled.",
    },
    ("2023 Y ANTERIORES", 1132): {
        "group": "liz-torres",
        "primaryPhone": "8482370937",
        "alternatePhone": "8482370917",
        "contactabilityStatus": "disconnected",
        "reason": "Older number had voicemail, no WhatsApp, and disconnected follow-ups.",
    },
    ("2024", 1641): {
        "group": "liz-torres",
        "primaryPhone": "8482370937",
        "primaryRecord": True,
        "contactabilityStatus": "not_current",
        "reason": "Latest contextual follow-up says moved out of state.",
    },
    ("2023 Y ANTERIORES", 722): {
        "group": "nelson-marquez",
        "primaryPhone": "9082053572",
        "alternatePhone": "9082023572",
        "contactabilityStatus": "needs_verification",
        "reason": "Near-match number merged, but both histories are no-answer style follow-ups.",
    },
    ("2023 Y ANTERIORES", 1087): {
        "group": "nelson-marquez",
        "primaryPhone": "9082053572",
        "primaryRecord": True,
        "contactabilityStatus": "needs_verification",
        "reason": "Near-match number merged, but both histories are no-answer style follow-ups.",
    },
}

GENERIC_CONTACT_NAMES = {
    "unknown ait usa lead",
    "prospecto",
    "requiere informacion",
}

SUPPRESS_CONTACTABILITY_STATUSES = {"wrong_number", "disconnected", "do_not_contact", "not_current", "no_phone"}
REVIEW_CONTACTABILITY_STATUSES = {"needs_verification", "low_confidence_alternate"}


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


def phone_resolution(sheet: str, row_number: int, original_phone: str | None) -> dict:
    resolution = MANUAL_PHONE_RESOLUTIONS.get((sheet, row_number))
    if not resolution:
        return {"phone": original_phone, "resolution": None}
    primary_phone = resolution.get("primaryPhone") or original_phone
    payload = {**resolution}
    if original_phone and original_phone != primary_phone:
        payload.setdefault("originalPhone", original_phone)
    return {"phone": primary_phone, "resolution": payload}


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


def contactability_from_text(value: object) -> dict:
    text = normalized_lower(value)
    if not text:
        return {"status": "unknown", "priority": 0}
    if any(marker in text for marker in ("wrong number", "numero erroneo", "número erroneo", "numero malo", "número malo", "pbx")):
        return {"status": "wrong_number", "priority": 100}
    if any(marker in text for marker in ("desconectado", "fuera de servicio", "number is not working", "not working")):
        return {"status": "disconnected", "priority": 95}
    if "se mudo" in text or "se mudó" in text or "otro estado" in text:
        return {"status": "not_current", "priority": 90}
    if any(marker in text for marker in ("no llamar mas", "no llamar más", "ya no llamar", "no volver a llamar")):
        return {"status": "do_not_contact", "priority": 88}
    if "no tiene whatsapp" in text or "no tiene whats" in text:
        return {"status": "no_whatsapp", "priority": 75}
    if any(marker in text for marker in ("no contesto", "no contestó", "voice m", "buzon", "buzón", "apagado")):
        return {"status": "attempted_no_answer", "priority": 40}
    if any(marker in text for marker in ("concretado", "inscrito", "vino", "promete venir", "presento examen", "presentó examen")):
        return {"status": "qualified", "priority": 70}
    if any(marker in text for marker in ("enviado", "mande mensaje", "mandé mensaje", "informacion", "información", "quiere", "llamada")):
        return {"status": "contacted", "priority": 55}
    return {"status": "unknown", "priority": 0}


def contactability_priority(status: object) -> int:
    return {
        "wrong_number": 100,
        "disconnected": 95,
        "not_current": 90,
        "do_not_contact": 88,
        "no_phone": 85,
        "no_whatsapp": 75,
        "qualified": 70,
        "reachable": 65,
        "contacted": 55,
        "attempted_no_answer": 40,
        "needs_verification": 35,
        "low_confidence_alternate": 25,
        "unknown": 0,
    }.get(normalized_lower(status), 0)


def source_tags_for(fields: dict, sheet: str) -> list[str]:
    tags = ["ait_usa_xlsx", sheet.lower().replace(" ", "_")]
    source = normalized_lower(fields.get("source"))
    if source:
        tags.append(source.replace(" ", "_"))
    if fields.get("owner"):
        tags.append("owner:" + normalized_lower(fields.get("owner")).replace(" ", "_"))
    return list(dict.fromkeys(tags))


def email_hint_for(value: object) -> str | None:
    text = normalize_text(value)
    if not text or "@" not in text:
        return None
    return text


def parsed_year(value: object) -> int | None:
    date_text = parse_excel_date(value)
    if not date_text:
        return None
    try:
        return int(date_text[:4])
    except ValueError:
        return None


def lead_quality_metadata(proposal: dict) -> dict:
    flags = []
    name = normalize_text(proposal.get("contactHint"))
    phone = normalize_text(proposal.get("phoneHint"))
    email = normalize_text(proposal.get("emailHint"))
    metadata = proposal.get("leadMetadata") or {}
    contactability = metadata.get("contactability") or {}
    contactability_status = normalized_lower(contactability.get("status"))
    source_tags = metadata.get("sourceTags") or []
    source_label = normalize_text(proposal.get("sourceLabel"))
    source_sheet_tag = normalize_text(proposal.get("sourceSheet")).lower().replace(" ", "_")
    lead_year = parsed_year(proposal.get("leadDate"))

    if not phone:
        flags.append({"code": "missing_phone", "label": "Missing phone", "severity": "blocker"})
    if not name or normalized_lower(name) == "unknown ait usa lead":
        flags.append({"code": "phone_only", "label": "Phone only", "severity": "review"})
    if email and "@" not in email:
        flags.append({"code": "invalid_email", "label": "Invalid email", "severity": "review"})
    if contactability_status in SUPPRESS_CONTACTABILITY_STATUSES:
        flags.append(
            {
                "code": contactability_status,
                "label": contactability_status.replace("_", " ").title(),
                "severity": "blocker",
            }
        )
    elif contactability_status in REVIEW_CONTACTABILITY_STATUSES:
        flags.append(
            {
                "code": contactability_status,
                "label": contactability_status.replace("_", " ").title(),
                "severity": "review",
            }
        )
    source_detail_tags = [
        tag for tag in source_tags
        if tag and not tag.startswith("owner:") and tag not in ("ait_usa_xlsx", source_sheet_tag)
    ]
    if not source_label and not source_detail_tags:
        flags.append({"code": "source_unclear", "label": "Source unclear", "severity": "info"})
    if lead_year and lead_year < 2025:
        flags.append({"code": "stale_or_old_lead", "label": "Old lead", "severity": "info"})

    if any(flag["severity"] == "blocker" for flag in flags):
        disposition = "suppress_from_follow_up"
    elif any(flag["severity"] == "review" for flag in flags):
        disposition = "needs_review"
    else:
        disposition = "ready_for_follow_up"

    return {
        "qualityFlags": flags,
        "qualityDisposition": disposition,
    }


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
                    "headerRow": HEADER_ROWS.get(sheet_name) if sheet_name in PRIMARY_SHEETS else None,
                }
            )
            for row in parsed["rows"]:
                row_inventory.append({"sheet": sheet_name, "rowNumber": row["rowNumber"], "values": row["dense"]})
    return {"workbookPath": str(workbook_file), "sheets": sheets, "rowInventory": row_inventory}


def lead_status(values: list[str]) -> str:
    text = normalized_lower(row_text(values))
    if "se mudo" in text or "se mudó" in text or "wrong number" in text or "pbx" in text:
        return "Lost"
    if any(marker in text for marker in ("ya no llamar", "no llamar", "no quiere", "no interesa", "no interesado")):
        return "Lost"
    if any(marker in text for marker in ("numero malo", "número malo", "fuera de servicio", "error", "wrong")):
        return "Lost"
    if any(marker in text for marker in ("concretado", "inscrito", "vino", "promete venir")):
        return "Qualified"
    if any(marker in text for marker in ("llamar", "contact", "seguimiento", "whatsapp", "mande mensaje", "mandé mensaje", "enviado", "quiere", "no contesto", "no contestó", "voice m", "buzon", "buzón")):
        return "Contacted"
    return "New Lead"


def first_text(*values: object) -> str:
    for value in values:
        text = normalize_text(value)
        if text:
            return text
    return ""


def is_separator_only(values: list[str]) -> bool:
    non_empty = [normalize_text(value) for value in values if normalize_text(value)]
    return bool(non_empty) and all(value == "*" for value in non_empty)


def is_marker_only(values: list[str]) -> bool:
    non_empty = [normalize_text(value) for value in values if normalize_text(value)]
    if not non_empty:
        return False
    semantic = [value for value in non_empty if normalized_lower(value) not in NOISE_MARKERS]
    if not semantic:
        return True
    return all(normalized_lower(value) in OWNER_MARKERS for value in semantic)


def looks_like_header(values: list[str]) -> bool:
    text = normalized_lower(row_text(values))
    return "llamar" in text and "prospecto" in text and "telefono" in text


def starts_reference_block(values: list[str]) -> bool:
    text = normalized_lower(row_text(values))
    return "importate para coordinadores" in text or "importante para coordinadores" in text


def lead_fields(sheet: str, row_number: int, values: list[str]) -> dict | None:
    default_phone = normalize_phone(cell_at(values, COLS["phone"]))
    if default_phone:
        resolved = phone_resolution(sheet, row_number, default_phone)
        return {
            "phone": resolved["phone"],
            "original_phone": default_phone,
            "phone_resolution": resolved["resolution"],
            "name": cell_at(values, COLS["name"]),
            "email": cell_at(values, COLS["email"]),
            "location": cell_at(values, COLS["location"]),
            "service": cell_at(values, COLS["service"]),
            "details": cell_at(values, COLS["details"]),
            "owner": cell_at(values, COLS["owner"]),
            "source": cell_at(values, COLS["source"]),
            "lead_date": cell_at(values, COLS["lead_date"]),
            "call_eligibility": cell_at(values, COLS["call"]),
            "day_preference": cell_at(values, COLS["day"]),
            "schedule_preference": cell_at(values, COLS["schedule"]),
            "test_status": cell_at(values, COLS["test"]),
            "level_hint": cell_at(values, COLS["level"]),
            "school_hint": cell_at(values, COLS["school"]),
        }

    if sheet != "2025":
        return None

    phone_h = normalize_phone(cell_at(values, col_to_number("H")))
    if phone_h and cell_at(values, col_to_number("B")):
        resolved = phone_resolution(sheet, row_number, phone_h)
        return {
            "phone": resolved["phone"],
            "original_phone": phone_h,
            "phone_resolution": resolved["resolution"],
            "name": cell_at(values, col_to_number("B")),
            "email": "",
            "location": "",
            "service": cell_at(values, col_to_number("D")),
            "details": row_text([
                cell_at(values, col_to_number("E")),
                cell_at(values, col_to_number("K")),
            ]),
            "owner": cell_at(values, col_to_number("I")),
            "source": cell_at(values, col_to_number("D")),
            "lead_date": first_text(cell_at(values, col_to_number("G")), cell_at(values, col_to_number("F"))),
            "call_eligibility": "",
            "day_preference": "",
            "schedule_preference": "",
            "test_status": "",
            "level_hint": "",
            "school_hint": "",
        }

    phone_f = normalize_phone(cell_at(values, col_to_number("F")))
    if phone_f and cell_at(values, col_to_number("E")):
        resolved = phone_resolution(sheet, row_number, phone_f)
        return {
            "phone": resolved["phone"],
            "original_phone": phone_f,
            "phone_resolution": resolved["resolution"],
            "name": cell_at(values, col_to_number("E")),
            "email": "",
            "location": "",
            "service": "",
            "details": row_text([
                cell_at(values, col_to_number("B")),
                cell_at(values, col_to_number("G")),
                cell_at(values, col_to_number("L")),
            ]),
            "owner": "",
            "source": cell_at(values, col_to_number("B")),
            "lead_date": first_text(cell_at(values, col_to_number("C")), cell_at(values, col_to_number("A"))),
            "call_eligibility": "",
            "day_preference": "",
            "schedule_preference": "",
            "test_status": "",
            "level_hint": "",
            "school_hint": "",
        }

    return None


def lead_proposal(sheet: str, row_number: int, values: list[str], fields: dict) -> dict:
    name = fields.get("name") or ""
    service = fields.get("service") or ""
    detail = fields.get("details") or ""
    original_text = row_text(values)
    contactability = contactability_from_text(original_text)
    resolution = fields.get("phone_resolution") or None
    if resolution and resolution.get("contactabilityStatus"):
        contactability = {
            "status": resolution["contactabilityStatus"],
            "priority": 110,
            "reason": resolution.get("reason"),
        }
    metadata = {
        "callEligibility": fields.get("call_eligibility") or None,
        "dayPreference": fields.get("day_preference") or None,
        "schedulePreference": fields.get("schedule_preference") or None,
        "testStatus": fields.get("test_status") or None,
        "levelHint": fields.get("level_hint") or None,
        "schoolHint": fields.get("school_hint") or None,
        "sourceTags": source_tags_for(fields, sheet),
        "contactability": {
            "status": contactability.get("status"),
            "reason": contactability.get("reason"),
        },
        "phoneResolution": resolution,
    }
    return {
        "businessUnit": BUSINESS_UNIT,
        "sourceType": "ait_usa_xlsx",
        "sourceName": "AIT USA Seguimiento Central",
        "sourceSheet": sheet,
        "sourceRowNumber": row_number,
        "contactHint": name or "Unknown AIT USA Lead",
        "phoneHint": fields["phone"],
        "originalPhoneHint": fields.get("original_phone") if fields.get("original_phone") != fields["phone"] else None,
        "emailHint": email_hint_for(fields.get("email")),
        "locationHint": fields.get("location") or None,
        "desiredService": service or None,
        "detailText": detail or None,
        "ownerHint": fields.get("owner") or None,
        "sourceLabel": fields.get("source") or None,
        "leadDate": parse_excel_date(fields.get("lead_date")),
        "statusHint": lead_status(values),
        "leadMetadata": {key: value for key, value in metadata.items() if value not in (None, {}, [])},
        "originalText": original_text,
        "rawValuesJson": values,
    }


def name_quality(name: object) -> tuple[int, int]:
    text = normalize_text(name)
    if not text:
        return (0, 0)
    words = [word for word in text.replace("/", " ").split() if word]
    return (len(words), len(text))


def merge_name_aliases(*names: object) -> list[str]:
    aliases = []
    seen = set()
    for name in names:
        text = normalize_text(name)
        key = normalized_lower(text)
        if text and key not in seen:
            aliases.append(text)
            seen.add(key)
    return aliases


def merge_unique_values(*values: object) -> list[str]:
    merged = []
    seen = set()
    for value in values:
        if isinstance(value, list):
            candidates = value
        else:
            candidates = [value]
        for candidate in candidates:
            text = normalize_text(candidate)
            key = normalized_lower(text)
            if text and key not in seen:
                merged.append(text)
                seen.add(key)
    return merged


def merge_lead_metadata(primary: dict | None, secondary: dict | None) -> dict:
    primary = primary or {}
    secondary = secondary or {}
    merged = {**secondary, **primary}
    merged["sourceTags"] = merge_unique_values(secondary.get("sourceTags") or [], primary.get("sourceTags") or [])

    resolutions = []
    for value in (secondary.get("phoneResolution"), primary.get("phoneResolution")):
        if value and value not in resolutions:
            resolutions.append(value)
    if resolutions:
        merged["phoneResolutions"] = resolutions

    primary_resolution = primary.get("phoneResolution") or {}
    if primary_resolution.get("primaryRecord") and primary.get("contactability"):
        merged["contactability"] = primary["contactability"]
    else:
        contactability_options = [
            primary.get("contactability") or {},
            secondary.get("contactability") or {},
        ]
        ranked = sorted(
            contactability_options,
            key=lambda item: contactability_priority(item.get("status")),
            reverse=True,
        )
        if ranked and ranked[0].get("status"):
            merged["contactability"] = ranked[0]

    return {key: value for key, value in merged.items() if value not in (None, {}, [])}


def merge_lead_candidate(existing: dict | None, candidate: dict, sheet: str, row_number: int) -> dict:
    if not existing:
        aliases = merge_name_aliases(candidate.get("contactHint"))
        candidate["nameAliases"] = aliases
        return {"source": {"sheet": sheet, "rowNumber": row_number}, "proposal": candidate}

    existing_proposal = existing["proposal"]
    existing_source = existing["source"]
    existing_resolution = (existing_proposal.get("leadMetadata") or {}).get("phoneResolution") or {}
    candidate_resolution = (candidate.get("leadMetadata") or {}).get("phoneResolution") or {}
    if candidate_resolution.get("primaryRecord") != existing_resolution.get("primaryRecord"):
        use_candidate_as_base = bool(candidate_resolution.get("primaryRecord"))
    else:
        use_candidate_as_base = row_sort_key({"sheet": sheet, "rowNumber": row_number}) >= row_sort_key(existing_source)
    base = candidate if use_candidate_as_base else existing_proposal
    other = existing_proposal if use_candidate_as_base else candidate

    aliases = merge_name_aliases(
        *(existing_proposal.get("nameAliases") or []),
        existing_proposal.get("contactHint"),
        candidate.get("contactHint"),
        *(candidate.get("nameAliases") or []),
    )
    best_name = max(aliases, key=name_quality, default=base.get("contactHint") or "")

    merged = {**base, "contactHint": best_name or base.get("contactHint"), "nameAliases": aliases}
    if not merged.get("emailHint") and other.get("emailHint"):
        merged["emailHint"] = other["emailHint"]
    if not merged.get("locationHint") and other.get("locationHint"):
        merged["locationHint"] = other["locationHint"]
    if not merged.get("desiredService") and other.get("desiredService"):
        merged["desiredService"] = other["desiredService"]
    if not merged.get("detailText") and other.get("detailText"):
        merged["detailText"] = other["detailText"]
    merged["leadMetadata"] = merge_lead_metadata(merged.get("leadMetadata"), other.get("leadMetadata"))
    merged["originalPhoneHints"] = merge_unique_values(
        existing_proposal.get("originalPhoneHints") or [],
        existing_proposal.get("originalPhoneHint"),
        candidate.get("originalPhoneHints") or [],
        candidate.get("originalPhoneHint"),
    )

    source = {"sheet": merged["sourceSheet"], "rowNumber": merged["sourceRowNumber"]}
    return {"source": source, "proposal": merged}


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


def event_proposal(sheet: str, row_number: int, values: list[str], phone: str, block: dict, original_phone: str | None = None) -> dict:
    contactability = contactability_from_text(block["message"])
    return {
        "businessUnit": BUSINESS_UNIT,
        "sourceType": "ait_usa_xlsx",
        "sourceName": "AIT USA Seguimiento Central",
        "sourceSheet": sheet,
        "sourceRowNumber": row_number,
        "recordType": "activity_event",
        "eventType": "ait_usa.follow_up",
        "phoneHint": phone,
        "originalPhoneHint": original_phone if original_phone and original_phone != phone else None,
        "message": block["message"],
        "actorHint": block.get("owner") or None,
        "occurredAt": parse_occurred_at(block.get("date"), block.get("time")),
        "eventDate": parse_excel_date(block.get("date")) or None,
        "eventTimeHint": block.get("time") or None,
        "contactabilityStatus": contactability["status"],
        "originalText": row_text(values),
        "rawValuesJson": values,
    }


def row_sort_key(row: dict) -> tuple[int, int]:
    return (SHEET_ORDER.get(row["sheet"], 999), row["rowNumber"])


def duplicate_name_key(name: object) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", normalized_lower(name)).strip()


def phone_distance(left: str, right: str) -> int | None:
    if len(left) != len(right):
        return None
    return sum(1 for a, b in zip(left, right) if a != b)


def possible_duplicate_groups(lead_records: list[dict]) -> list[dict]:
    by_name: dict[str, list[dict]] = {}
    for record in lead_records:
        contact = record["proposedContactJson"]
        key = duplicate_name_key(contact.get("name"))
        if key in GENERIC_CONTACT_NAMES or len(key.split()) < 2:
            continue
        by_name.setdefault(key, []).append(record)

    groups = []
    manual_groups = {
        resolution["group"]
        for resolution in MANUAL_PHONE_RESOLUTIONS.values()
        if resolution.get("group")
    }
    for name_key, records in by_name.items():
        phones = sorted({record["proposedContactJson"]["phone"] for record in records if record["proposedContactJson"].get("phone")})
        if len(phones) < 2:
            continue
        pairs = []
        for index, phone in enumerate(phones):
            for other in phones[index + 1:]:
                distance = phone_distance(phone, other)
                if distance is not None and distance <= 2:
                    pairs.append({"phone": phone, "otherPhone": other, "distance": distance})
        if not pairs:
            continue
        resolution_groups = {
            (record["proposedLeadJson"].get("leadMetadata") or {}).get("phoneResolution", {}).get("group")
            for record in records
        }
        if any(group in manual_groups for group in resolution_groups if group):
            continue
        groups.append(
            {
                "name": records[0]["proposedContactJson"]["name"],
                "nameKey": name_key,
                "phones": phones,
                "sourceRows": [
                    {
                        "sourceSheet": record["sourceSheet"],
                        "sourceRowNumber": record["sourceRowNumber"],
                        "phone": record["proposedContactJson"]["phone"],
                    }
                    for record in records
                ],
                "nearPhonePairs": pairs,
                "resolution": "needs_review",
            }
        )
    return groups


def should_ignore_primary_row(sheet: str, row_number: int, values: list[str], in_reference_block: bool = False) -> bool:
    if row_number <= HEADER_ROWS.get(sheet, 9):
        return True
    if in_reference_block:
        return True
    text = normalized_lower(row_text(values))
    if not text:
        return True
    return (
        text.startswith("aqui empieza")
        or text.startswith("aquí empieza")
        or is_separator_only(values)
        or is_marker_only(values)
        or looks_like_header(values)
        or starts_reference_block(values)
    )


def build_staging_artifact(report: dict, workbook_path: str | Path) -> dict:
    workbook_file = Path(workbook_path)
    file_hash = hashlib.sha256(workbook_file.read_bytes()).hexdigest()
    generated_at = datetime.now(timezone.utc).isoformat()

    source_rows = []
    lead_candidates: dict[str, dict] = {}
    event_records = []
    seen_event_keys = set()
    active_phone_by_sheet: dict[str, str] = {}
    reference_block_by_sheet: set[str] = set()
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
        starts_reference = starts_reference_block(values)
        ignored = should_ignore_primary_row(sheet, row_number, values, sheet in reference_block_by_sheet)
        if starts_reference:
            reference_block_by_sheet.add(sheet)
        fields = None if ignored else lead_fields(sheet, row_number, values)
        phone = fields["phone"] if fields else None
        original_phone = fields.get("original_phone") if fields else None
        blocks = follow_up_blocks(values)
        parse_status = "ignored" if ignored else "needs_review"

        if phone:
            active_phone_by_sheet[sheet] = phone
            candidate = lead_proposal(sheet, row_number, values, fields)
            existing = lead_candidates.get(phone)
            lead_candidates[phone] = merge_lead_candidate(existing, candidate, sheet, row_number)
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
                proposal = event_proposal(sheet, row_number, values, event_phone, block, original_phone)
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
        quality_metadata = lead_quality_metadata(proposal)
        proposal["leadMetadata"] = {
            **(proposal.get("leadMetadata") or {}),
            **quality_metadata,
        }
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
                    "nameAliases": proposal.get("nameAliases") or [],
                    "phone": phone,
                    "email": proposal.get("emailHint"),
                    "sourceLabel": proposal.get("sourceLabel") or "AIT USA Seguimiento Central",
                    "sourceSheet": proposal["sourceSheet"],
                    "sourceRowNumber": proposal["sourceRowNumber"],
                    "sourceTags": (proposal.get("leadMetadata") or {}).get("sourceTags") or [],
                    "contactability": (proposal.get("leadMetadata") or {}).get("contactability") or {},
                    "qualityFlags": quality_metadata["qualityFlags"],
                    "qualityDisposition": quality_metadata["qualityDisposition"],
                    "phoneResolutions": (proposal.get("leadMetadata") or {}).get("phoneResolutions") or (
                        [proposal["leadMetadata"]["phoneResolution"]]
                        if (proposal.get("leadMetadata") or {}).get("phoneResolution")
                        else []
                    ),
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

    duplicate_groups = possible_duplicate_groups(lead_records)
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
            "possibleDuplicateGroups": len(duplicate_groups),
        },
        "possibleDuplicateGroups": duplicate_groups,
        "sourceRows": source_rows,
        "normalizedRecords": normalized_records,
        "reviewItems": review_items,
    }
