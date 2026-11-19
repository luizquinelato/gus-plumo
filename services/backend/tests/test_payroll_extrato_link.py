"""Testes unitários: descrição e rótulo da folha vinculada ao extrato."""

from decimal import Decimal
from types import SimpleNamespace
from unittest import TestCase

from datetime import date

from app.services.monthly_projection_service import (
    _anchor_day1_final_payroll_link,
    _apply_payroll_extrato_link,
    _payroll_linked_description,
    _payroll_semantic_label,
)


class PayrollExtratoLinkTest(TestCase):
    def test_semantic_label_strips_legacy_estimativa_and_extrato_suffix(self) -> None:
        self.assertEqual(
            _payroll_semantic_label("Salário (fim do mês) (estimativa)"),
            "Salário (fim do mês)",
        )
        self.assertEqual(
            _payroll_semantic_label("Salário (fim do mês)"),
            "Salário (fim do mês)",
        )
        self.assertEqual(
            _payroll_semantic_label("Adiantamento salarial — PIX EMPRESA"),
            "Adiantamento salarial",
        )

    def test_anchor_day1_when_salary_credit_before_month(self) -> None:
        proj = SimpleNamespace(
            year_month="2025-03",
            expected_date=date(2025, 3, 1),
            payroll_kind="final",
            description="Salário (fim do mês)",
        )
        stmt = SimpleNamespace(date=date(2025, 2, 28))
        self.assertTrue(_anchor_day1_final_payroll_link(proj, stmt, "2025-03"))

    def test_opening_adjusted_description_constant(self) -> None:
        from app.services.monthly_projection_service import FINAL_PAYROLL_OPENING_ADJUSTED_DESCRIPTION

        self.assertIn("líquido", FINAL_PAYROLL_OPENING_ADJUSTED_DESCRIPTION.lower())

    def test_apply_link_keeps_day1_calendar_when_anchored(self) -> None:
        proj = SimpleNamespace(
            source="payroll",
            source_table=None,
            source_id=None,
            year_month="2025-03",
            expected_date=date(2025, 3, 1),
            payroll_kind="final",
            description="Salário (fim do mês)",
            kind="income",
            amount=0,
            my_amount=0,
        )
        stmt = SimpleNamespace(
            id=99,
            date=date(2025, 2, 27),
            amount="5000.00",
            ownership_percentage=100,
            description="PIX FOLHA",
        )
        anchored = _apply_payroll_extrato_link(proj, stmt, launch_year_month="2025-03")
        self.assertTrue(anchored)
        self.assertEqual(proj.expected_date, date(2025, 3, 1))
        self.assertEqual(proj.year_month, "2025-03")
        self.assertEqual(proj.source_id, 99)
        self.assertIn("PIX FOLHA", proj.description)

    def test_linked_description_combines_folha_and_extrato(self) -> None:
        proj = SimpleNamespace(description="Salário (fim do mês)")
        stmt = SimpleNamespace(description="CREDITO FOLHA")
        self.assertEqual(
            _payroll_linked_description(proj, stmt),
            "Salário (fim do mês) — CREDITO FOLHA",
        )

    def test_opening_adjusted_description_constant_matches_service(self) -> None:
        from app.services.monthly_projection_service import FINAL_PAYROLL_OPENING_ADJUSTED_DESCRIPTION

        self.assertIn("abertura", FINAL_PAYROLL_OPENING_ADJUSTED_DESCRIPTION.lower())