import unittest

from ait_signs_xlsx import (
    amount_hint_for_structured_row,
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
                10: "HACEN BANDERAS",
                13: "LLAMAR DE NUEVO EN LA TARDE",
            }
        )

        hints = structured_proposal_hints(values, "lead_intake")
        self.assertIsNone(hints["contactHint"])
        self.assertEqual(hints["workDescription"], "HACEN BANDERAS")

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


if __name__ == "__main__":
    unittest.main()
