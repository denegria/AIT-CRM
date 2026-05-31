import tempfile
import unittest
from pathlib import Path

from ait_usa_xlsx import BUSINESS_UNIT, build_staging_artifact, col_to_number


def row_values(**cells):
    max_col = max((col_to_number(col) for col in cells), default=0)
    values = [""] * max_col
    for col, value in cells.items():
        values[col_to_number(col) - 1] = value
    return values


def fake_report(rows):
    return {
        "sheets": [
            {
                "name": "2024",
                "rowCount": 12,
                "nonEmptyRowCount": 2,
                "maxCols": 30,
                "isPrimary": True,
                "headerRow": 9,
            },
            {
                "name": "ENE A MAY 2025",
                "rowCount": 12,
                "nonEmptyRowCount": 1,
                "maxCols": 30,
                "isPrimary": True,
                "headerRow": 9,
            },
            {
                "name": "2025",
                "rowCount": 12,
                "nonEmptyRowCount": 1,
                "maxCols": 30,
                "isPrimary": True,
                "headerRow": 9,
            },
        ],
        "rowInventory": rows,
    }


class AitUsaParserTest(unittest.TestCase):
    def build_payload(self, rows):
        with tempfile.NamedTemporaryFile() as fh:
            Path(fh.name).write_bytes(b"ait usa fixture")
            return build_staging_artifact(fake_report(rows), fh.name)

    def test_continuation_follow_up_uses_active_prior_phone(self):
        payload = self.build_payload(
            [
                {
                    "sheet": "2024",
                    "rowNumber": 10,
                    "values": row_values(F="45300", G="Maria Lopez", I="(201) 555-0199", S="WHATSAPP"),
                },
                {
                    "sheet": "2024",
                    "rowNumber": 11,
                    "values": row_values(V="45301", W="LILI", Y="Se le envio informacion y pide llamada manana"),
                },
            ]
        )

        events = [record for record in payload["normalizedRecords"] if record["recordType"] == "activity_event"]
        self.assertEqual(len(events), 1)
        proposal = events[0]["proposedNoteJson"]
        self.assertEqual(proposal["phoneHint"], "2015550199")
        self.assertEqual(proposal["eventType"], "ait_usa.follow_up")
        self.assertEqual(proposal["sourceSheet"], "2024")
        self.assertEqual(proposal["sourceRowNumber"], 11)
        self.assertEqual(proposal["businessUnit"], BUSINESS_UNIT)

    def test_carryover_duplicate_event_is_skipped_and_2025_lead_wins(self):
        duplicate_event = row_values(
            F="45809",
            G="Saul",
            I="732-430-8734",
            S="LLAMADA",
            V="45809",
            W="LILI",
            Y="Confirmo que viene a clase",
        )
        payload = self.build_payload(
            [
                {"sheet": "ENE A MAY 2025", "rowNumber": 1441, "values": duplicate_event},
                {"sheet": "2025", "rowNumber": 12, "values": duplicate_event},
            ]
        )

        leads = [record for record in payload["normalizedRecords"] if record["recordType"] == "lead"]
        events = [record for record in payload["normalizedRecords"] if record["recordType"] == "activity_event"]

        self.assertEqual(len(leads), 1)
        self.assertEqual(leads[0]["sourceSheet"], "2025")
        self.assertEqual(leads[0]["sourceRowNumber"], 12)
        self.assertEqual(leads[0]["proposedLeadJson"]["phoneHint"], "7324308734")
        self.assertEqual(len(events), 1)
        self.assertEqual(payload["counts"]["duplicateActivityEventsSkipped"], 1)


if __name__ == "__main__":
    unittest.main()
