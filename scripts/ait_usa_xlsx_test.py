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
                "headerRow": 10,
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

    def test_same_phone_keeps_richer_contact_name_as_alias(self):
        payload = self.build_payload(
            [
                {
                    "sheet": "ENE A MAY 2025",
                    "rowNumber": 1677,
                    "values": row_values(F="38518", G="CARLOS SAULES", I="9.084445894E9"),
                },
                {
                    "sheet": "2025",
                    "rowNumber": 353,
                    "values": row_values(F="38518", G="CARLOS", I="9.084445894E9"),
                },
            ]
        )

        leads = [record for record in payload["normalizedRecords"] if record["recordType"] == "lead"]

        self.assertEqual(len(leads), 1)
        self.assertEqual(leads[0]["sourceSheet"], "2025")
        self.assertEqual(leads[0]["sourceRowNumber"], 353)
        self.assertEqual(leads[0]["proposedContactJson"]["name"], "CARLOS SAULES")
        self.assertEqual(leads[0]["proposedLeadJson"]["contactHint"], "CARLOS SAULES")
        self.assertEqual(leads[0]["proposedContactJson"]["nameAliases"], ["CARLOS SAULES", "CARLOS"])

    def test_separator_and_2025_header_rows_are_ignored(self):
        payload = self.build_payload(
            [
                {"sheet": "2023 Y ANTERIORES", "rowNumber": 66, "values": row_values(U="*", Z="*")},
                {
                    "sheet": "2025",
                    "rowNumber": 10,
                    "values": row_values(D="LLAMAR ?", G="PROSPECTO NAME", I="TELEFONO", Y="MENSAJE"),
                },
            ]
        )

        self.assertEqual(payload["counts"]["normalizedRecords"], 0)
        self.assertEqual(payload["counts"]["reviewItems"], 0)

    def test_2025_shifted_coupon_rows_create_leads(self):
        payload = self.build_payload(
            [
                {
                    "sheet": "2025",
                    "rowNumber": 2168,
                    "values": row_values(
                        A="121",
                        B="EDY CIPRIAN",
                        D="INTRO",
                        E="SE LE DIO EL BONO EN LA CALLE DE 35USD",
                        F="45830",
                        G="45830",
                        H="908 404 8077",
                        K="SE LES ENTREGO BONO PERO NO HAN ASISTIDO",
                    ),
                },
                {
                    "sheet": "2025",
                    "rowNumber": 2039,
                    "values": row_values(
                        B="PENDIENTE",
                        C="46146",
                        E="KARINA BARRERA",
                        F="510 978 0010",
                        G="AGOSTO 30",
                        L="165",
                        V="46143",
                        W="LILI",
                        X="0.4513888888888889",
                        Y="DICE QUE VA A HACER EL PAGO AHORA",
                    ),
                },
                {
                    "sheet": "2025",
                    "rowNumber": 2176,
                    "values": row_values(E="IMPORTATE PARA COORDINADORES Y VENTAS (FAVOR LEERLO)"),
                },
                {
                    "sheet": "2025",
                    "rowNumber": 2188,
                    "values": row_values(G="1.0", H="ZELLE", I="1). POR ZELLE (EL PHONE es 732-379-0593)"),
                },
            ]
        )

        leads = [record for record in payload["normalizedRecords"] if record["recordType"] == "lead"]
        events = [record for record in payload["normalizedRecords"] if record["recordType"] == "activity_event"]

        self.assertEqual({lead["proposedContactJson"]["phone"] for lead in leads}, {"9084048077", "5109780010"})
        self.assertEqual({lead["proposedContactJson"]["name"] for lead in leads}, {"EDY CIPRIAN", "KARINA BARRERA"})
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["proposedNoteJson"]["phoneHint"], "5109780010")

    def test_manual_near_phone_resolution_merges_confirmed_duplicate(self):
        payload = self.build_payload(
            [
                {
                    "sheet": "2023 Y ANTERIORES",
                    "rowNumber": 10,
                    "values": row_values(
                        F="43328",
                        G="MARIA SOLIS",
                        I="732 645 6593",
                        L="INGLES",
                        Y="LE MANDE MENSAJE INFORMATIVO DE LAS CLASES",
                        V="45406",
                        W="KARLA",
                    ),
                },
                {
                    "sheet": "2023 Y ANTERIORES",
                    "rowNumber": 925,
                    "values": row_values(
                        F="45196",
                        G="MARIA SOLIS",
                        I="732 646 6593",
                        Y="WRONG NUMBER",
                        V="45395",
                        W="ANGELINA",
                    ),
                },
            ]
        )

        leads = [record for record in payload["normalizedRecords"] if record["recordType"] == "lead"]
        events = [record for record in payload["normalizedRecords"] if record["recordType"] == "activity_event"]

        self.assertEqual(len(leads), 1)
        self.assertEqual(leads[0]["sourceRowNumber"], 10)
        self.assertEqual(leads[0]["proposedContactJson"]["phone"], "7326456593")
        self.assertEqual(leads[0]["proposedLeadJson"]["originalPhoneHints"], ["7326466593"])
        self.assertEqual(leads[0]["proposedLeadJson"]["leadMetadata"]["contactability"]["status"], "reachable")
        self.assertEqual(events[1]["proposedNoteJson"]["phoneHint"], "7326456593")
        self.assertEqual(events[1]["proposedNoteJson"]["originalPhoneHint"], "7326466593")
        self.assertEqual(events[1]["proposedNoteJson"]["contactabilityStatus"], "wrong_number")

    def test_structured_lead_metadata_preserves_follow_up_fields(self):
        payload = self.build_payload(
            [
                {
                    "sheet": "2024",
                    "rowNumber": 10,
                    "values": row_values(
                        D="SI",
                        E="LILI",
                        F="45300",
                        G="Maria Lopez",
                        I="(201) 555-0199",
                        N="SABADO",
                        O="10 AM",
                        P="PRESENTO",
                        Q="BASICO",
                        R="BOUND BROOK",
                        S="WHATSAPP",
                    ),
                },
            ]
        )

        lead = [record for record in payload["normalizedRecords"] if record["recordType"] == "lead"][0]
        metadata = lead["proposedLeadJson"]["leadMetadata"]

        self.assertEqual(metadata["callEligibility"], "SI")
        self.assertEqual(metadata["dayPreference"], "SABADO")
        self.assertEqual(metadata["schedulePreference"], "10 AM")
        self.assertEqual(metadata["testStatus"], "PRESENTO")
        self.assertEqual(metadata["levelHint"], "BASICO")
        self.assertEqual(metadata["schoolHint"], "BOUND BROOK")
        self.assertIn("whatsapp", metadata["sourceTags"])


if __name__ == "__main__":
    unittest.main()
