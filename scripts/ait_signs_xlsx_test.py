import unittest

from ait_signs_xlsx import (
    amount_hint_for_structured_row,
    build_staging_artifact,
    contact_identity_fields,
    extract_first_phone,
    status_hint_for_row,
    structured_proposal_hints,
)


def row_with(columns):
    values = [""] * 62
    for column, value in columns.items():
        values[column - 1] = value
    return values


class AitSignsWorkbookMappingTest(unittest.TestCase):
    def test_estimate_row_number_is_not_used_as_money_hint(self):
        values = row_with(
            {
                1: "1.0",
                5: "LUXURY",
                6: "SANTIAGO RODRIGUEZ",
                7: "732766 2649",
                10: "HUDIES POLOS T-SHIRT PRENDAS Y ESTAMPADO",
                12: "YA NO LLAMAR LO ENVIO HACER A OTRO LADO POR PRECIO",
                34: "0",
            }
        )

        self.assertIsNone(amount_hint_for_structured_row(values, "estimates"))
        hints = structured_proposal_hints(values, "estimates")
        self.assertIsNone(hints["moneyHint"])
        self.assertEqual(hints["customerName"], "LUXURY")
        self.assertEqual(hints["contactName"], "SANTIAGO RODRIGUEZ")
        self.assertEqual(hints["phoneHint"], "7327662649")

    def test_estimate_total_uses_total_column(self):
        values = row_with(
            {
                1: "10",
                5: "PINEBERRY",
                7: "856 308 9146",
                17: "585.0",
                18: "38.75625",
                19: "623.75625",
            }
        )

        hints = structured_proposal_hints(values, "estimates")
        self.assertEqual(hints["moneyHint"], "623.75625")
        self.assertEqual(hints["totalAmountHint"], "623.75625")
        self.assertEqual(hints["netAmountHint"], "585.0")
        self.assertEqual(hints["taxAmountHint"], "38.75625")

    def test_work_description_is_not_used_as_structured_contact(self):
        values = row_with(
            {
                7: "609 802 4421",
                9: "service@example.com",
                10: "HACEN BANDERAS",
                13: "LLAMAR DE NUEVO EN LA TARDE",
            }
        )

        hints = structured_proposal_hints(values, "lead_intake")
        self.assertIsNone(hints["contactHint"])
        self.assertEqual(hints["workDescription"], "HACEN BANDERAS")
        self.assertEqual(hints["emailHint"], "service@example.com")

    def test_identity_fields_exclude_row_narrative_and_financial_artifacts(self):
        fields = contact_identity_fields(
            {
                "customerName": "PINEBERRY",
                "contactName": "Alex",
                "phoneHint": "8563089146",
                "emailHint": "alex@example.com",
                "workDescription": "channel letters",
                "originalText": "PINEBERRY | channel letters | 623.75",
                "moneyHint": "623.75",
                "rawValuesJson": ["PINEBERRY", "channel letters", "623.75"],
            }
        )

        self.assertEqual(
            fields,
            {
                "customerName": "PINEBERRY",
                "contactName": "Alex",
                "phoneHint": "8563089146",
                "emailHint": "alex@example.com",
            },
        )

    def test_obvious_lead_statuses_are_classified(self):
        no_interest = row_with(
            {
                5: "VANESSA",
                7: "929 521 1970",
                13: "MAGNETICO LO REALIZO EN OTRO LUGAR",
            }
        )
        converted = row_with(
            {
                5: "CUEVA CONSTRUCTION",
                6: "ALEX",
                7: "973 652 5368",
                10: "YA ES UN WORK ORDER",
                13: "DAR SEGUIMIENTO AL PROCESO",
            }
        )
        invalid = row_with(
            {
                6: "VICTOR",
                7: "516 360 8241",
                13: "NUMERO NO EXISTE O ERRONEO",
            }
        )

        self.assertEqual(status_hint_for_row("1. INTERESADOS", no_interest), "not_interested")
        self.assertEqual(status_hint_for_row("1. INTERESADOS", converted), "converted_to_work_order")
        self.assertEqual(status_hint_for_row("1. INTERESADOS", invalid), "invalid_contact")

    def test_decimal_money_values_are_not_phone_numbers(self):
        values = row_with(
            {
                17: "1650.0",
                18: "109.3125",
                19: "1650.0",
            }
        )

        self.assertIsNone(extract_first_phone(values))

    def test_date_like_values_are_not_phone_numbers(self):
        values = row_with(
            {
                7: "05.03.2023",
                13: "12/28/2023 NO CONTESTA LINA",
            }
        )

        hints = structured_proposal_hints(values, "completed_paid")
        self.assertIsNone(hints["phoneHint"])
        self.assertIsNone(extract_first_phone(values))

    def test_no_phone_marker_is_not_a_phone_number(self):
        values = row_with(
            {
                5: "BLUE OCEAN POOL",
                7: "SIN TELEFONO",
                13: "READY 05.03.2023",
            }
        )

        hints = structured_proposal_hints(values, "completed_paid")
        self.assertIsNone(hints["phoneHint"])
        self.assertEqual(hints["customerName"], "BLUE OCEAN POOL")

    def test_multiple_us_numbers_in_one_cell_use_first_real_phone(self):
        values = row_with(
            {
                5: "BREMMA TREE SERVICE",
                6: "OLGER BREMMAN MILEDY",
                7: "908 421 94 04\n732 357 54 38",
                10: "(1000) BUSSINES CARD",
            }
        )

        hints = structured_proposal_hints(values, "completed_paid")
        self.assertEqual(hints["phoneHint"], "9084219404")
        self.assertEqual(extract_first_phone(values), "9084219404")

    def test_invalid_non_us_phone_length_is_not_identity(self):
        values = row_with(
            {
                5: "BAD PHONE CUSTOMER",
                7: "908 421 94040",
            }
        )

        hints = structured_proposal_hints(values, "completed_paid")
        self.assertIsNone(hints["phoneHint"])

    def test_identityless_rows_do_not_create_normalized_records(self):
        report = {
            "sheets": [
                {
                    "name": "2. ESTIMADOS",
                    "rowCount": 1,
                    "nonEmptyRowCount": 1,
                    "headerRow": None,
                    "maxCols": 19,
                },
                {
                    "name": "1. INTERESADOS",
                    "rowCount": 1,
                    "nonEmptyRowCount": 1,
                    "headerRow": None,
                    "maxCols": 13,
                },
            ],
            "rowInventory": [
                {
                    "sheet": "2. ESTIMADOS",
                    "rowNumber": 145,
                    "kind": "financial_line",
                    "confidence": 0.62,
                    "summary": "1650.0 | 109.3125 | 1650.0",
                    "values": row_with({17: "1650.0", 18: "109.3125", 19: "1650.0"}),
                },
                {
                    "sheet": "1. INTERESADOS",
                    "rowNumber": 14,
                    "kind": "note",
                    "confidence": 0.66,
                    "summary": "NO CONTESTO 03/28/24 ANGELINA 4:45 PM",
                    "values": row_with({13: "NO CONTESTO 03/28/24 ANGELINA 4:45 PM"}),
                },
            ],
        }

        artifact = build_staging_artifact(report, __file__)

        self.assertEqual(artifact["counts"]["normalizedRecords"], 0)
        self.assertEqual(artifact["counts"]["reviewItems"], 2)
        self.assertEqual(
            [row["parseStatus"] for row in artifact["sourceRows"]],
            ["needs_review", "needs_review"],
        )
        self.assertTrue(
            all(
                item["reason"].startswith("Missing customer/contact/phone identity:")
                for item in artifact["reviewItems"]
            )
        )

    def test_normalized_records_carry_identity_only_field_list(self):
        report = {
            "sheets": [
                {
                    "name": "2. ESTIMADOS",
                    "rowCount": 1,
                    "nonEmptyRowCount": 1,
                    "headerRow": None,
                    "maxCols": 19,
                },
            ],
            "rowInventory": [
                {
                    "sheet": "2. ESTIMADOS",
                    "rowNumber": 22,
                    "kind": "record_candidate",
                    "confidence": 0.82,
                    "summary": "PINEBERRY | channel letters | 856 308 9146 | 623.75",
                    "values": row_with(
                        {
                            5: "PINEBERRY",
                            7: "856 308 9146",
                            10: "channel letters",
                            19: "623.75",
                        }
                    ),
                },
            ],
        }

        artifact = build_staging_artifact(report, __file__)
        proposal = artifact["normalizedRecords"][0]["proposedEstimateJson"]

        self.assertEqual(
            proposal["contactIdentityFields"],
            {
                "customerName": "PINEBERRY",
                "contactHint": "PINEBERRY",
                "phoneHint": "8563089146",
            },
        )
        self.assertEqual(proposal["workDescription"], "channel letters")
        self.assertEqual(proposal["moneyHint"], "623.75")


if __name__ == "__main__":
    unittest.main()
