#!/usr/bin/env python3

from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

STAGING_PATH = Path("docs/ait-signs-import-staging.json")
OUTPUT_PATH = Path("src/lib/ait-signs-seed.js")

EMPLOYEES = [
    {"id": "emp-1", "name": "Carlos Rivera"},
    {"id": "emp-2", "name": "Dana Kim"},
    {"id": "emp-3", "name": "Marcus Hall"},
]

STATUS_MAP = {
    "lead": "Intake",
    "lead_contacted": "Contacted",
    "lead_follow_up": "Contacted",
    "lead_lost": "Lost",
    "estimate": "Proposal Sent",
    "estimate_lost": "Lost",
    "work_order": "In Progress",
    "work_order_paid": "Completed",
    "payment": "Paid",
    "note": "Contacted",
}

SOURCE_MAP = {
    "FB": "Facebook Ads",
    "WEB SITE": "Website",
    "WEB PAGE": "Website",
    "WEBSITE": "Website",
    "REFERRAL": "Referral",
}


def clean_text(value: object) -> str:
    return " ".join(str(value or "").strip().split())


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower())
    return slug.strip("-") or "item"


def extract_phone(text: str) -> str:
    digits = re.sub(r"\D", "", text or "")
    return digits if 7 <= len(digits) <= 15 else ""


def extract_money(text: str) -> float:
    if not text:
        return 0.0
    match = re.search(r"\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)", text)
    if not match:
        return 0.0
    token = match.group(1).replace(",", "")
    try:
        return float(token)
    except ValueError:
        return 0.0


def extract_date(text: str, fallback_days: int) -> str:
    text = clean_text(text)
    patterns = [
        r"(\d{1,2})/(\d{1,2})/(\d{2,4})",
        r"(\d{1,2})/(\d{1,2})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if not match:
            continue
        month = int(match.group(1))
        day = int(match.group(2))
        year = int(match.group(3)) if len(match.groups()) == 3 else 2024
        if year < 100:
            year += 2000
        try:
            return datetime(year, month, day).date().isoformat()
        except ValueError:
            continue
    return (datetime(2024, 1, 1) + timedelta(days=fallback_days)).date().isoformat()


def source_label(text: str) -> str:
    upper = text.upper()
    for needle, label in SOURCE_MAP.items():
        if needle in upper:
            return label
    return "AIT Signs Import"


def status_label(record_type: str, text: str) -> str:
    upper = text.upper()
    if any(marker in upper for marker in ["NO CONTEST", "NO LLAMAR", "YA NO", "SOLICITO NO"]):
        return STATUS_MAP[f"{record_type}_lost"] if f"{record_type}_lost" in STATUS_MAP else "Lost"
    if any(marker in upper for marker in ["SE CONTACT", "LLAMAR", "SEGUIMIENTO", "VOLVER"]):
        if record_type == "lead":
            return STATUS_MAP["lead_contacted"]
        return STATUS_MAP["note"]
    if record_type == "estimate":
        return STATUS_MAP["estimate"]
    if record_type == "work_order":
        return STATUS_MAP["work_order"]
    if record_type == "payment":
        return STATUS_MAP["payment"]
    return STATUS_MAP.get(record_type, "Intake")


def build_title(text: str, fallback: str) -> str:
    text = clean_text(text)
    if not text:
        return fallback
    parts = [part.strip() for part in text.split("|") if part.strip()]
    candidate = parts[0] if parts else text
    candidate = re.sub(r"\s+", " ", candidate)
    return candidate[:60]


def choose_contact_name(values: list[str], text: str) -> str:
    cleaned = [clean_text(v) for v in values if clean_text(v)]
    stop = {
        "AI", "AIT", "FB", "PHONE", "CONTACTO", "ADDRESS", "EMAIL", "STATUS",
        "OBSERVACIONES", "DESIGNER", "CHIEF", "ACTIVO", "MONTO", "TAX", "TOTAL",
        "BALANCE", "PAGOS", "DATE", "HORA", "MENSAJE", "COORD", "TEXT", "PRIOR",
    }
    for value in cleaned:
        upper = value.upper()
        if any(ch.isdigit() for ch in value):
            continue
        if len(value) < 3:
            continue
        if upper in stop:
            continue
        if any(marker in upper for marker in ["LLAMAR", "CONTEST", "SEGUIMIENTO", "PAG", "ENTREG", "NOTA"]):
            continue
        if " " in value or value.isalpha():
            return value
    for value in cleaned:
        if any(ch.isdigit() for ch in value):
            continue
        if len(value) >= 3:
            return value
    return build_title(text, "AIT Contact")


def assign_employee(index: int) -> str:
    return EMPLOYEES[index % len(EMPLOYEES)]["id"]


def derive_record_type(row_kind: str, sheet_family: str) -> str:
    if row_kind == "financial_line":
        return "payment"
    if sheet_family == "lead_intake":
        return "lead"
    if sheet_family == "estimates":
        return "estimate"
    if sheet_family in {"work_orders", "completed_paid"}:
        return "work_order"
    return "note"


def build_seed() -> dict:
    payload = json.loads(STAGING_PATH.read_text())
    contact_map: dict[str, dict] = {}
    contact_order: list[str] = []
    work_orders: list[dict] = []
    financials: list[dict] = []
    tasks: list[dict] = []
    calendar_events: list[dict] = []
    sales_ledger: list[dict] = []

    contact_index = 0
    work_order_index = 0
    financial_index = 0
    task_index = 0
    event_index = 0
    ledger_index = 0

    for record in payload["normalizedRecords"]:
        proposed = (
            record.get("proposedLeadJson")
            or record.get("proposedEstimateJson")
            or record.get("proposedWorkOrderJson")
            or record.get("proposedPaymentJson")
            or record.get("proposedNoteJson")
            or {}
        )
        text = clean_text(proposed.get("originalText", ""))
        values = proposed.get("rawValuesJson") or []
        sheet = record["sourceSheet"]
        row_kind = proposed.get("rowKind", "note")
        record_type = record.get("recordType") or derive_record_type(row_kind, proposed.get("sourceType", "mixed"))
        record_type = {
            "payment_snapshot": "payment",
            "work_order": "work_order",
            "estimate": "estimate",
            "lead": "lead",
            "note": "note",
        }.get(record_type, record_type)
        phone = clean_text(proposed.get("phoneHint") or "")
        contact_name = proposed.get("contactHint") or choose_contact_name(values, text)
        contact_key = phone or slugify(f"{contact_name}-{sheet}-{record['sourceRowNumber']}")
        if contact_key not in contact_map:
            contact_index += 1
            status = status_label(record_type, text)
            if record_type == "lead" and status == "Intake" and row_kind == "note":
                status = "Contacted"
            contact_map[contact_key] = {
                "id": f"c-{contact_index}",
                "name": contact_name,
                "email": "",
                "phone": phone or "",
                "status": status,
                "source": source_label(text),
                "assignedTo": assign_employee(contact_index - 1),
                "lastContact": extract_date(text, contact_index),
                "notes": [],
            }
            contact_order.append(contact_key)

        contact = contact_map[contact_key]
        note_date = extract_date(text, record["sourceRowNumber"])
        if text:
            contact["notes"].append({"text": text, "date": note_date})
            contact["lastContact"] = max(contact["lastContact"], note_date)
        if record_type in {"lead", "estimate", "work_order", "payment"}:
            if record_type == "lead" and contact["status"] == "Intake" and any(
                marker in text.upper() for marker in ["SE CONTACT", "LLAMAR", "SEGUIMIENTO"]
            ):
                contact["status"] = "Contacted"

        if record_type == "work_order":
            work_order_index += 1
            amount = float(proposed.get("moneyHint") or extract_money(text))
            work_orders.append(
                {
                    "id": f"wo-{work_order_index}",
                    "number": f"WO-AIT-{record['sourceRowNumber']}",
                    "title": build_title(text, f"Work Order {work_order_index}"),
                    "client": contact["name"],
                    "contactId": contact["id"],
                    "priority": "High" if any(marker in text.upper() for marker in ["URGENT", "EMERGENCY", "CASH"]) else "Medium",
                    "status": "Completed" if any(marker in text.upper() for marker in ["ENTREGADO", "PAGADO", "PAID"]) else "In Progress",
                    "assignedTo": contact["assignedTo"],
                    "dueDate": note_date,
                    "description": text,
                    "estimatedCost": amount,
                }
            )
        elif record_type == "estimate":
            financial_index += 1
            amount = float(proposed.get("moneyHint") or extract_money(text))
            financials.append(
                {
                    "id": f"f-{financial_index}",
                    "number": f"EST-AIT-{record['sourceRowNumber']}",
                    "type": "Estimate",
                    "client": contact["name"],
                    "contactId": contact["id"],
                    "amount": amount,
                    "date": note_date,
                    "dueDate": note_date,
                    "status": "Pending",
                    "items": [{"desc": build_title(text, "Estimate"), "qty": 1, "rate": amount}],
                }
            )
        elif record_type == "payment":
            financial_index += 1
            amount = float(proposed.get("moneyHint") or extract_money(text))
            financials.append(
                {
                    "id": f"f-{financial_index}",
                    "number": f"REC-AIT-{record['sourceRowNumber']}",
                    "type": "Receipt",
                    "client": contact["name"],
                    "contactId": contact["id"],
                    "amount": amount,
                    "date": note_date,
                    "status": "Paid",
                    "items": [{"desc": build_title(text, "Payment"), "qty": 1, "rate": amount}],
                }
            )

        if any(marker in text.upper() for marker in ["LLAMAR", "SEGUIMIENTO", "CALL", "FOLLOW UP", "VOLVER"]):
            task_index += 1
            tasks.append(
                {
                    "id": f"t-{task_index}",
                    "title": f"Follow up with {contact['name']}",
                    "assignedTo": contact["assignedTo"],
                    "dueDate": note_date,
                    "completed": False,
                    "priority": "High" if "NO CONTEST" in text.upper() else "Medium",
                }
            )
            event_index += 1
            calendar_events.append(
                {
                    "id": f"ev-{event_index}",
                    "title": f"Follow-up — {contact['name']}",
                    "date": note_date,
                    "type": "call",
                    "contactId": contact["id"],
                }
            )

        sales_ledger.append(
            {
                "id": f"sl-{ledger_index + 1}",
                "contactId": contact["id"],
                "date": note_date,
                "note": text,
                "stage": contact["status"],
            }
        )
        ledger_index += 1

    contacts = [contact_map[key] for key in contact_order]
    if not tasks:
        tasks.append(
            {
                "id": "t-1",
                "title": "Review AIT Signs import staging",
                "assignedTo": "emp-1",
                "dueDate": "2024-03-28",
                "completed": False,
                "priority": "High",
            }
        )
    if not calendar_events:
        calendar_events.append(
            {"id": "ev-1", "title": "AIT Signs import review", "date": "2024-03-28", "type": "meeting"}
        )

    return {
        "sourceName": payload["sourceName"],
        "sourceHash": payload["workbookFileHash"],
        "businessUnits": [
            {"id": "bu-ait-signs", "name": "AIT Signs", "label": "Divisions", "color": "#4a7aff", "isActive": True},
            {"id": "bu-ait-usa-institute", "name": "AIT USA Institute", "label": "Divisions", "color": "#22c55e", "isActive": True},
            {"id": "bu-ait-photo-video", "name": "AIT Photo & Video", "label": "Divisions", "color": "#a78bfa", "isActive": True},
            {"id": "bu-ait-taxes", "name": "AIT Taxes", "label": "Divisions", "color": "#ef4444", "isActive": True},
        ],
        "STATUSES": {
            "lead": ["Intake", "Estimate", "Work Order", "Fulfillment", "Invoice / Payment"],
            "workOrder": ["Pending", "In Progress", "Completed", "On Hold"],
            "financial": ["Draft", "Pending", "Paid", "Overdue"],
            "priority": ["Low", "Medium", "High"],
        },
        "SOURCES": ["AIT Signs Import", "Facebook Ads", "Website", "Referral", "Cold Call", "Google Ads"],
        "EMPLOYEES": EMPLOYEES,
        "contacts": contacts,
        "workOrders": work_orders,
        "financials": financials,
        "tasks": tasks,
        "calendarEvents": calendar_events,
        "salesLedger": sales_ledger[: max(7, min(25, len(sales_ledger)))],
    }


def render_js(seed: dict) -> str:
    lines: list[str] = []
    lines.append("// Generated from docs/ait-signs-import-staging.json")
    lines.append("// Do not edit by hand.")
    lines.append("")
    lines.append(f"export const STATUSES = {json.dumps(seed['STATUSES'], indent=2)};")
    lines.append("")
    lines.append(f"export const SOURCES = {json.dumps(seed['SOURCES'], indent=2)};")
    lines.append("")
    lines.append(f"export const EMPLOYEES = {json.dumps(seed['EMPLOYEES'], indent=2)};")
    lines.append("")
    lines.append(f"export const businessUnits = {json.dumps(seed['businessUnits'], indent=2)};")
    lines.append("")
    lines.append(f"export const contacts = {json.dumps(seed['contacts'], indent=2)};")
    lines.append("")
    lines.append(f"export const workOrders = {json.dumps(seed['workOrders'], indent=2)};")
    lines.append("")
    lines.append(f"export const financials = {json.dumps(seed['financials'], indent=2)};")
    lines.append("")
    lines.append(f"export const tasks = {json.dumps(seed['tasks'], indent=2)};")
    lines.append("")
    lines.append(f"export const calendarEvents = {json.dumps(seed['calendarEvents'], indent=2)};")
    lines.append("")
    lines.append(f"export const salesLedger = {json.dumps(seed['salesLedger'], indent=2)};")
    return "\n".join(lines) + "\n"


def main() -> int:
    seed = build_seed()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(render_js(seed), encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")
    print(
        json.dumps(
            {
                "businessUnits": len(seed["businessUnits"]),
                "contacts": len(seed["contacts"]),
                "workOrders": len(seed["workOrders"]),
                "financials": len(seed["financials"]),
                "tasks": len(seed["tasks"]),
                "calendarEvents": len(seed["calendarEvents"]),
                "salesLedger": len(seed["salesLedger"]),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
