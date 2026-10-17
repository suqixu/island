"""Offline renderer timing tests; run with the same NumPy environment as rendering."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('scenic_renderer', Path(__file__).resolve().parents[1] / 'scripts/render-scenic-music.py')
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


class ScoreTimingTest(unittest.TestCase):
    def test_existing_constant_tempo(self):
        score = {'bpm': 80, 'beats': 148}
        self.assertEqual(renderer.score_time(score, 148), 111)

    def test_jasmine_written_slowdown_and_boundary_note(self):
        score = {'bpm': 80, 'beats': 148, 'tempoChanges': [{'beat': 136, 'bpm': 61}]}
        self.assertEqual(renderer.score_time(score, 136), 102)
        self.assertAlmostEqual(renderer.score_time(score, 148), 102 + 12 * 60 / 61)
        # A note spanning the change must use both tempos.
        self.assertAlmostEqual(renderer.score_time(score, 137) - renderer.score_time(score, 135), .75 + 60 / 61)

    def test_multiple_changes_accumulate_in_order(self):
        score = {'bpm': 60, 'beats': 12, 'tempoChanges': [{'beat': 4, 'bpm': 120}, {'beat': 8, 'bpm': 30}]}
        self.assertEqual(renderer.score_time(score, 12), 14)


if __name__ == '__main__':
    unittest.main()
