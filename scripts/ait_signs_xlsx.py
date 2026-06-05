from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
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

PHONE_RE = re.compile(r"(?<!\d)(?:\+?\d[\d\s().-]{5,}\d)(?!\d)")
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
MONEY_RE = re.compile(r"(?<!\w)\$?\s*\d[\d,]*(?:\.\d+)?(?!\w)")
EXCEL_SERIAL_RE = re.compile(r"^4[0-9]{4}(?:\.0)?$")
DATE_LIKE_RE = re.compile(r"^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$")


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


def normalize_text(value: object) -> str:
    return " ".join(str(value).strip().split())


def row_text(values: list[str]) -> str:
    return " | ".join(normalize_text(v) for v in values if normalize_text(v))


def sheet_family(sheet_name: str) -> str:
    lower = sheet_name.lower()
    if "interes" in lower:
        return "lead_intake"
    if "estim" in lower:
        return "estimates"
    if "termin" in lower or "pagad" in lower:
        return "completed_paid"
    if "work order" in lower:
        return "work_orders"
    return "mixed"


def source_type_for_sheet(sheet_name: str) -> str:
    family = sheet_family(sheet_name)
    if family == "lead_intake":
        return "lead"
    if family == "estimates":
        return "estimate"
    if family == "work_orders":
        return "work_order"
    if family == "completed_paid":
        return "archive"
    return "mixed"


def status_hint_for_sheet(sheet_name: str) -> str:
    family = sheet_family(sheet_name)
    if family == "lead_intake":
        return "new"
    if family == "estimates":
        return "estimate_review"
    if family == "work_orders":
        return "in_production"
    if family == "completed_paid":
        return "delivered_paid"
    return "needs_review"


COL_CUSTOMER = 5
COL_CONTACT = 6
COL_PHONE = 7
COL_WORK_DESCRIPTION = 10
COL_STATUS = 12
COL_OBSERVATION = 13
COL_DESIGNER = 14
COL_DELIVERY_DATE = 15
COL_NET = 17
COL_TAX = 18
COL_TOTAL = 19
COL_ADVANCE = 20
COL_BALANCE = 21
PAYMENT_AMOUNT_COLUMNS = (22, 25, 28, 31)
PRIMARY_TOTAL_COLUMNS = (COL_TOTAL, COL_NET)


def extract_first_phone(values: list[str]) -> str | None:
    candidates: list[tuple[int, str]] = []
    for value in values:
        text = normalize_text(value)
        if not text:
            continue
        compact = text.replace(",", "")
        if "." in compact and compact.replace(".", "", 1).isdigit():
            continue
        if EXCEL_SERIAL_RE.match(compact):
            continue
        for match in PHONE_RE.finditer(text):
            phone = normalize_text(match.group(0))
            if DATE_LIKE_RE.match(phone):
                continue
            digits = re.sub(r"\D", "", phone)
            if 7 <= len(digits) <= 15:
                candidates.append((len(digits), digits))
    if not candidates:
        return None
    return max(candidates, key=lambda item: item[0])[1]


def normalize_phone_hint(value: object) -> str | None:
    text = normalize_text(value)
    if not text:
        return None
    lower = text.lower()
    if "sin telefono" in lower or "sin teléfono" in lower or "no phone" in lower:
        return None
    compact = text.replace(",", "")
    if "." in compact and compact.replace(".", "", 1).isdigit():
        return None
    if EXCEL_SERIAL_RE.match(compact) or DATE_LIKE_RE.match(compact):
        return None
    digits = re.sub(r"\D", "", text)
    return digits if 7 <= len(digits) <= 15 else None


def extract_first_email(values: list[str]) -> str | None:
    for value in values:
        text = normalize_text(value)
        if not text:
            continue
        match = EMAIL_RE.search(text)
        if match:
            return match.group(0).lower()
    return None


def money_value(value: object) -> str | None:
    text = normalize_text(value)
    if not text:
        return None
    if EXCEL_SERIAL_RE.match(text.replace(",", "")):
        return None
    match = MONEY_RE.search(text)
    if not match:
        return None
    token = match.group(0).replace("$", "").strip().replace(",", "")
    if not token:
        return None
    try:
        amount = float(token)
    except ValueError:
        return None
    if amount <= 0:
        return None
    return token


def cell_at(values: list[str], column_number: int) -> str:
    index = column_number - 1
    if index < 0 or index >= len(values):
        return ""
    return normalize_text(values[index])


def first_money_in_columns(values: list[str], columns: tuple[int, ...]) -> str | None:
    for column in columns:
        token = money_value(cell_at(values, column))
        if token:
            return token
    return None


def explicit_payment_hint(values: list[str]) -> str | None:
    return first_money_in_columns(values, PAYMENT_AMOUNT_COLUMNS)


def money_like_count(values: list[str]) -> int:
    count = 0
    for value in values:
        text = normalize_text(value)
        if not text:
            continue
        if "$" in text:
            count += 1
            continue
        compact = text.replace(",", "")
        if EXCEL_SERIAL_RE.match(compact):
            continue
        try:
            amount = float(compact)
        except ValueError:
            continue
        if amount >= 100:
            count += 1
    return count


def extract_contact_hint(values: list[str]) -> str | None:
    stopwords = {
        "ai",
        "ait",
        "fb",
        "phone",
        "phone:",
        "customer",
        "contacto",
        "address",
        "email",
        "status",
        "observaciones",
        "designer",
        "chief",
        "activo",
        "monto",
        "tax",
        "total",
        "balance",
    }
    for value in values:
        text = normalize_text(value)
        if not text:
            continue
        upper = text.upper()
        if any(ch.isdigit() for ch in text):
            continue
        if len(text) < 3:
            continue
        if upper.lower() in stopwords:
            continue
        if any(marker in upper for marker in ("LLAMAR", "NO CONTEST", "SE CONTACT", "PAG", "ENTREG", "ESTA EN", "VOLVER")):
            continue
        if " " in text or text.isalpha():
            return text
    return None


def structured_cell(values: list[str], column_number: int) -> str | None:
    value = cell_at(values, column_number)
    return value or None


def structured_money(values: list[str], column_number: int) -> str | None:
    return money_value(cell_at(values, column_number))


def amount_hint_for_structured_row(values: list[str], family: str) -> str | None:
    if family in {"estimates", "work_orders", "completed_paid"}:
        return first_money_in_columns(values, PRIMARY_TOTAL_COLUMNS)
    return None


def status_hint_for_row(sheet_name: str, values: list[str]) -> str:
    family = sheet_family(sheet_name)
    base_status = status_hint_for_sheet(sheet_name)
    work_text = " ".join(
        value
        for value in [
            cell_at(values, COL_STATUS),
            cell_at(values, COL_OBSERVATION),
            cell_at(values, COL_WORK_DESCRIPTION),
        ]
        if value
    ).lower()

    no_interest_markers = (
        "ya no llamar",
        "no volver a llamar",
        "no esta interesado",
        "no está interesado",
        "no necesita",
        "no requiere",
        "otro lado",
        "realizo en otro lugar",
        "realizó en otro lugar",
    )
    invalid_contact_markers = (
        "numero no existe",
        "número no existe",
        "numero erroneo",
        "número erróneo",
        "erroneo",
        "erróneo",
    )
    converted_markers = (
        "ya es un work order",
        "ya tiene el trabajo en proceso",
        "trabajo en proceso",
    )
    estimate_markers = (
        "ya se envio estimado",
        "ya se envió estimado",
        "se envio estimado",
        "se envió estimado",
    )

    if any(marker in work_text for marker in invalid_contact_markers):
        return "invalid_contact"
    if any(marker in work_text for marker in converted_markers):
        return "converted_to_work_order"
    if any(marker in work_text for marker in no_interest_markers):
        return "not_interested" if family == "lead_intake" else "lost"
    if family == "lead_intake" and any(marker in work_text for marker in estimate_markers):
        return "estimate_sent"
    return base_status


def structured_proposal_hints(values: list[str], family: str) -> dict:
    total_amount = structured_money(values, COL_TOTAL)
    net_amount = structured_money(values, COL_NET)
    tax_amount = structured_money(values, COL_TAX)
    advance_amount = structured_money(values, COL_ADVANCE)
    balance_amount = structured_money(values, COL_BALANCE)
    customer = structured_cell(values, COL_CUSTOMER)
    contact = structured_cell(values, COL_CONTACT)
    phone = normalize_phone_hint(structured_cell(values, COL_PHONE))

    return {
        "customerName": customer,
        "contactName": contact,
        "contactHint": customer or contact or None,
        "phoneHint": phone,
        "emailHint": extract_first_email(values),
        "workDescription": structured_cell(values, COL_WORK_DESCRIPTION),
        "statusText": structured_cell(values, COL_STATUS),
        "observationText": structured_cell(values, COL_OBSERVATION),
        "designer": structured_cell(values, COL_DESIGNER),
        "deliveryDateHint": structured_cell(values, COL_DELIVERY_DATE),
        "netAmountHint": net_amount,
        "taxAmountHint": tax_amount,
        "totalAmountHint": total_amount,
        "advanceAmountHint": advance_amount,
        "balanceAmountHint": balance_amount,
        "moneyHint": amount_hint_for_structured_row(values, family),
    }


def has_contact_identity(proposal: dict) -> bool:
    for key in ("customerName", "contactName", "contactHint", "phoneHint", "emailHint", "addressHint"):
        value = proposal.get(key)
        if value is not None and normalize_text(value):
            return True
    return False


def contact_identity_fields(proposal: dict) -> dict:
    fields: dict[str, str] = {}
    for key in (
        "customerName",
        "companyName",
        "contactName",
        "contactHint",
        "phoneHint",
        "emailHint",
        "addressHint",
    ):
        value = proposal.get(key)
        if value is not None and normalize_text(value):
            fields[key] = normalize_text(value)
    aliases = [
        normalize_text(value)
        for value in proposal.get("nameAliases", [])
        if normalize_text(value)
    ]
    if aliases:
        fields["nameAliases"] = aliases
    return fields


def build_staging_artifact(report: dict, workbook_path: str | Path) -> dict:
    workbook_file = Path(workbook_path)
    source_name = workbook_file.stem
    file_bytes = workbook_file.read_bytes()
    file_hash = hashlib.sha256(file_bytes).hexdigest()
    generated_at = datetime.now(timezone.utc).isoformat()

    sheet_summaries = []
    counts = {
        "sourceRows": 0,
        "normalizedRecords": 0,
        "reviewItems": 0,
    }
    for sheet in report["sheets"]:
        sheet_summaries.append(
            {
                "name": sheet["name"],
                "family": sheet_family(sheet["name"]),
                "sourceType": source_type_for_sheet(sheet["name"]),
                "rowCount": sheet["rowCount"],
                "nonEmptyRowCount": sheet["nonEmptyRowCount"],
                "headerRow": sheet["headerRow"],
                "maxCols": sheet["maxCols"],
            }
        )

    source_rows = []
    normalized_records = []
    review_items = []

    header_rows_by_sheet = {
        sheet["name"]: sheet["headerRow"]
        for sheet in report["sheets"]
        if sheet.get("headerRow") is not None
    }

    for row in report["rowInventory"]:
        header_row = header_rows_by_sheet.get(row["sheet"])
        is_before_data = header_row is not None and row["rowNumber"] <= header_row
        source_row = {
            "sheet": row["sheet"],
            "sourceSheet": row["sheet"],
            "sourceRowNumber": row["rowNumber"],
            "rowKind": row["kind"],
            "parseStatus": "pending",
            "rawValuesJson": row["values"],
            "rawText": row["summary"],
        }
        if row["kind"] == "blank":
            source_row["parseStatus"] = "ignored"
        elif is_before_data:
            source_row["parseStatus"] = "ignored" if row["kind"] in {"header", "section_header"} else "needs_review"
        elif row["kind"] == "financial_line" and sheet_family(row["sheet"]) == "mixed":
            source_row["parseStatus"] = "needs_review"
        elif row["kind"] in {"record_candidate", "financial_line", "note"}:
            source_row["parseStatus"] = "parsed"
        elif row["kind"] in {"header", "section_header"}:
            source_row["parseStatus"] = "ignored"
        else:
            source_row["parseStatus"] = "needs_review"
        if row["kind"] == "record_candidate" and row["confidence"] < 0.75:
            source_row["parseStatus"] = "needs_review"

        source_rows.append(source_row)

        if source_row["parseStatus"] == "parsed":
            sheet_name = row["sheet"]
            family = sheet_family(sheet_name)
            structured_hints = structured_proposal_hints(row["values"], family)
            structured_phone = structured_hints.get("phoneHint")
            if structured_phone and not (7 <= len(str(structured_phone)) <= 15):
                structured_phone = None
            phone = structured_phone or extract_first_phone(row["values"])
            contact_hint = structured_hints.get("contactHint")
            if not contact_hint and family == "mixed":
                contact_hint = extract_contact_hint(row["values"])
            money_hint = structured_hints.get("moneyHint")
            payment_hint = explicit_payment_hint(row["values"])
            status_hint = status_hint_for_row(sheet_name, row["values"])
            proposed_base = {
                "businessUnit": "AIT Signs",
                "sourceSheet": sheet_name,
                "sourceRowNumber": row["rowNumber"],
                "rowKind": row["kind"],
                "sourceType": source_type_for_sheet(sheet_name),
                "statusHint": status_hint,
                "importConfidence": row["confidence"],
                "contactHint": contact_hint,
                "phoneHint": phone,
                "moneyHint": money_hint,
                "paymentHint": payment_hint,
                "originalText": row["summary"],
                "rawValuesJson": row["values"],
            } | {
                key: value
                for key, value in structured_hints.items()
                if value is not None and key not in {"contactHint", "phoneHint", "moneyHint"}
            }
            if not has_contact_identity(proposed_base):
                source_row["parseStatus"] = "needs_review"
                review_items.append(
                    {
                        "sourceSheet": row["sheet"],
                        "sourceRowNumber": row["rowNumber"],
                        "reviewType": row["kind"],
                        "reason": f"Missing customer/contact/phone identity: {row['summary']}",
                        "reviewStatus": "pending",
                        "proposedResolutionJson": {
                            "workbookPath": str(workbook_file),
                            "businessUnit": "AIT Signs",
                            "sourceType": source_type_for_sheet(row["sheet"]),
                            "rowKind": row["kind"],
                            "confidence": row["confidence"],
                        },
                    }
                )
                continue
            proposed_base["contactIdentityFields"] = contact_identity_fields(proposed_base)
            record_type = "note"
            proposed_field = "proposedNoteJson"
            if row["kind"] == "note":
                record_type = "note"
                proposed_field = "proposedNoteJson"
            elif family == "lead_intake":
                record_type = "lead"
                proposed_field = "proposedLeadJson"
            elif family == "estimates":
                record_type = "estimate"
                proposed_field = "proposedEstimateJson"
            elif family in {"work_orders", "completed_paid"}:
                record_type = "work_order"
                proposed_field = "proposedWorkOrderJson"

            normalized_record = {
                "sourceSheet": sheet_name,
                "sourceRowNumber": row["rowNumber"],
                "recordType": record_type,
                "confidenceScore": row["confidence"],
                "status": "pending",
                proposed_field: proposed_base,
            }
            if record_type == "lead":
                normalized_record["proposedLeadJson"] = proposed_base | {
                    "leadStage": status_hint,
                }
            elif record_type == "estimate":
                normalized_record["proposedEstimateJson"] = proposed_base | {
                    "estimateStage": status_hint,
                }
            elif record_type == "work_order":
                normalized_record["proposedWorkOrderJson"] = proposed_base | {
                    "workOrderStage": status_hint,
                }
            else:
                normalized_record["proposedNoteJson"] = proposed_base | {
                    "noteStage": status_hint,
                }
            normalized_records.append(normalized_record)

            if payment_hint and family in {"estimates", "work_orders", "completed_paid"}:
                normalized_records.append(
                    {
                        "sourceSheet": sheet_name,
                        "sourceRowNumber": row["rowNumber"],
                        "recordType": "payment_snapshot",
                        "confidenceScore": min(row["confidence"], 0.74),
                        "status": "pending",
                        "proposedPaymentJson": proposed_base
                        | {
                            "moneyHint": payment_hint,
                            "paymentStage": status_hint_for_sheet(sheet_name),
                            "paymentSource": "explicit_payment_columns",
                        },
                    }
                )

        if (
            (is_before_data and row["kind"] not in {"blank", "header", "section_header"})
            or row["kind"] in {"header", "section_header", "misc_text"}
            or (row["kind"] == "financial_line" and sheet_family(row["sheet"]) == "mixed")
        ) or (
            row["kind"] == "record_candidate" and row["confidence"] < 0.75
        ):
            review_items.append(
                {
                    "sourceSheet": row["sheet"],
                    "sourceRowNumber": row["rowNumber"],
                    "reviewType": row["kind"],
                    "reason": row["summary"],
                    "reviewStatus": "pending",
                    "proposedResolutionJson": {
                        "workbookPath": str(workbook_file),
                        "businessUnit": "AIT Signs",
                        "sourceType": source_type_for_sheet(row["sheet"]),
                        "rowKind": row["kind"],
                        "confidence": row["confidence"],
                    },
                }
            )

    counts["sourceRows"] = len(source_rows)
    counts["normalizedRecords"] = len(normalized_records)
    counts["reviewItems"] = len(review_items)

    return {
        "generatedAt": generated_at,
        "workbookPath": str(workbook_file),
        "workbookFileHash": file_hash,
        "sourceName": source_name,
        "sourceType": "xlsx",
        "businessUnit": "AIT Signs",
        "sheets": sheet_summaries,
        "counts": counts,
        "sourceRows": source_rows,
        "normalizedRecords": normalized_records,
        "reviewItems": review_items,
    }


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

    if len(non_empty) == 1:
        compact = non_empty[0].replace(",", "")
        if compact.replace(".", "", 1).isdigit():
            return {
                "sheet": sheet_name,
                "rowNumber": row_number,
                "kind": "blank",
                "confidence": 1.0,
                "summary": joined,
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

    has_phone = extract_first_phone(values) is not None
    has_name = any(token.isalpha() for token in non_empty)
    has_money = money_like_count(values) >= 2 or "$" in joined
    has_note = any(marker in lower for marker in ["llamar", "contesto", "contact", "pago", "entregado", "seguimiento", "no contest", "volver"])

    if has_phone and (has_name or has_note):
        kind = "record_candidate"
        confidence = 0.82
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
