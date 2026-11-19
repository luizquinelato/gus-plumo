"""Estimativa de folha: origem payroll_estimate e helpers de slot."""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from app.services.monthly_projection_service import (
    PAYROLL_ESTIMATE_SOURCE,
    _analyze_payroll_reconciliation,
    _has_payslip_for_slot,
    _payroll_semantic_label,
    _projection_payroll_slot,
    _promote_estimate_from_payslip,
)


class PayrollEstimateHelpersTest(TestCase):
    def test_semantic_label_no_estimativa_suffix_required(self) -> None:
        self.assertEqual(
            _payroll_semantic_label("Salário (fim do mês)"),
            "Salário (fim do mês)",
        )
        self.assertEqual(
            _payroll_semantic_label("Salário (fim do mês) (estimativa)"),
            "Salário (fim do mês)",
        )

    def test_promote_estimate_from_payslip_sets_payroll_source(self) -> None:
        proj = SimpleNamespace(
            source=PAYROLL_ESTIMATE_SOURCE,
            description="Adiantamento salarial",
            amount=Decimal("100"),
            my_amount=Decimal("100"),
            payroll_kind="advance",
            expected_date=None,
        )
        payload = {
            "description": "Adiantamento salarial",
            "amount": Decimal("1500"),
            "expected_date": SimpleNamespace(year=2025, month=3, day=15),
            "payroll_kind": "advance",
            "source": "payroll",
        }
        _promote_estimate_from_payslip(proj, payload)
        self.assertEqual(proj.source, "payroll")
        self.assertEqual(proj.amount, Decimal("1500"))
        self.assertEqual(proj.payroll_kind, "advance")

    def test_has_payslip_for_slot_without_db(self) -> None:
        self.assertFalse(_has_payslip_for_slot(None, 1, 1, "2025-03", None))
        self.assertFalse(_has_payslip_for_slot(None, 1, 1, "2025-03", ""))


class PayrollEstimateSourceTest(TestCase):
    def test_payroll_estimate_constant(self) -> None:
        self.assertEqual(PAYROLL_ESTIMATE_SOURCE, "payroll_estimate")


class ProjectionPayrollSlotTest(TestCase):
    def test_slot_from_payroll_kind(self) -> None:
        adv = SimpleNamespace(payroll_kind="advance", description="x")
        self.assertEqual(_projection_payroll_slot(adv), "advance")

    def test_slot_from_description_legacy(self) -> None:
        fin = SimpleNamespace(payroll_kind=None, description="Salário (fim do mês)")
        self.assertEqual(_projection_payroll_slot(fin), "final")


class PayrollManualLinkTest(TestCase):
    @patch("app.services.monthly_projection_service._find_extrato_match_for_payroll", return_value=None)
    def test_manual_link_binds_statement_in_range(self, _mock_match) -> None:
        stmt = SimpleNamespace(
            id=501,
            date=date(2025, 3, 14),
            amount=Decimal("1800"),
            ownership_percentage=100,
            tenant_id=1,
            account_id=1,
        )
        advance = SimpleNamespace(
            id=10,
            description="Adiantamento salarial",
            amount=Decimal("1500"),
            expected_date=date(2025, 3, 15),
            year_month="2025-03",
            source=PAYROLL_ESTIMATE_SOURCE,
            payroll_kind="advance",
            source_table=None,
            source_id=None,
        )

        class FakeQuery:
            def filter(self, *args, **kwargs):
                return self

            def first(self):
                return stmt

        class FakeDb:
            def query(self, model):
                return FakeQuery()

        removed, links, need_confirm = _analyze_payroll_reconciliation(
            [advance],
            db=FakeDb(),
            tenant_id=1,
            account_id=1,
            range_start=date(2025, 3, 11),
            range_end_inclusive=date(2025, 3, 31),
            payroll_resolve=None,
            payroll_link={10: 501},
            used_statement_ids=set(),
            payroll_promote=None,
        )
        self.assertEqual(removed, [])
        self.assertEqual(len(links), 1)
        self.assertIs(links[0][0], advance)
        self.assertIs(links[0][1], stmt)
        self.assertEqual(need_confirm, [])


class PayrollReconcilePerIdTest(TestCase):
    @patch("app.services.monthly_projection_service._find_extrato_match_for_payroll", return_value=None)
    def test_clear_applies_only_to_resolved_projection_id(self, _mock_match) -> None:
        advance = SimpleNamespace(
            id=10,
            description="Adiantamento salarial",
            amount=Decimal("1500"),
            expected_date=date(2025, 3, 15),
            year_month="2025-03",
            source=PAYROLL_ESTIMATE_SOURCE,
            payroll_kind="advance",
            source_table=None,
            source_id=None,
        )
        final = SimpleNamespace(
            id=20,
            description="Salário (fim do mês)",
            amount=Decimal("5000"),
            expected_date=date(2025, 3, 1),
            year_month="2025-03",
            source="payroll",
            payroll_kind="final",
            source_table=None,
            source_id=None,
        )
        removed, _links, need_confirm = _analyze_payroll_reconciliation(
            [advance, final],
            db=None,
            tenant_id=1,
            account_id=1,
            range_start=date(2025, 3, 1),
            range_end_inclusive=date(2025, 3, 31),
            payroll_resolve={10: "clear"},
            payroll_link=None,
            used_statement_ids=set(),
            payroll_promote=None,
        )
        self.assertEqual(len(removed), 1)
        self.assertIs(removed[0], advance)
        self.assertEqual(len(need_confirm), 1)
        self.assertEqual(need_confirm[0].projection_id, 20)