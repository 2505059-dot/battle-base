import unittest
from pathlib import Path

from pes_master_probe import ABILITY_LABELS, parse

FIXTURE = Path(__file__).parent / "fixtures" / "pes5-parser-sample.html"
LIVE_FIXTURE = Path(__file__).parent / "fixtures" / "pes5-live-vicente-excerpt.html"

class ParserTests(unittest.TestCase):
    def test_team_row_preserves_raw_ovr_above_99(self):
        page = parse(FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(len(page.rows), 1)
        self.assertEqual(page.rows[0]["name"], "Sample")
        self.assertEqual(page.rows[0]["displayed_ovr"], 108)
        self.assertEqual(page.rows[0]["nationality"], "Argentina")
        self.assertEqual(page.rows[0]["summary"]["Pas"], 95)

    def test_player_table_preserves_all_raw_fields_and_large_values(self):
        page = parse(FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(page.abilities["Attack"], 110)
        self.assertEqual(page.abilities["Reponse"], 78)
        self.assertEqual(set(page.abilities), set(ABILITY_LABELS))
        self.assertEqual(len(page.abilities), 28)

    def test_authentic_live_detail_excerpt_parses_all_28_fields(self):
        html = LIVE_FIXTURE.read_text(encoding="utf-8")
        page = parse(html)
        self.assertEqual(page.h1.strip(), "88 Vicente")
        self.assertIn("Spain", html)
        self.assertEqual(set(page.abilities), set(ABILITY_LABELS))
        self.assertEqual(len(page.abilities), 28)
        self.assertEqual(page.abilities["Acceleration"], 90)
        self.assertEqual(page.abilities["Top Speed"], 86)
        self.assertEqual(page.abilities["Shot Power"], 84)

if __name__ == "__main__":
    unittest.main()
