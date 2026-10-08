import unittest
from pathlib import Path

from pes_master_probe import ABILITY_LABELS, parse

FIXTURE = Path(__file__).parent / "fixtures" / "pes5-parser-sample.html"

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

if __name__ == "__main__":
    unittest.main()
