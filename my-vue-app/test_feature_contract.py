import json
import math
import unittest
from pathlib import Path

from feature_extractor import FEATURE_CONTRACT, FEATURE_SIZE, build_feature_vector


FIXTURES_PATH = Path(__file__).resolve().parent / "src/model/feature-fixtures.v1.json"
MANIFEST_PATH = Path(__file__).resolve().parent / "public/models/manifest.json"
MODEL_PATH = Path(__file__).resolve().parent / "public/models/classifier.onnx"


class FeatureContractTest(unittest.TestCase):
    def test_deployed_model_manifest(self):
        with MANIFEST_PATH.open("r", encoding="utf-8") as manifest_file:
            manifest = json.load(manifest_file)

        self.assertEqual(manifest["featureSize"], FEATURE_SIZE)
        self.assertEqual(manifest["featureContractVersion"], FEATURE_CONTRACT["version"])
        self.assertIn(FEATURE_CONTRACT["version"].encode(), MODEL_PATH.read_bytes())

    def test_shared_feature_fixtures(self):
        with FIXTURES_PATH.open("r", encoding="utf-8") as fixture_file:
            fixtures = json.load(fixture_file)

        self.assertEqual(fixtures["contractVersion"], FEATURE_CONTRACT["version"])
        for case in fixtures["cases"]:
            with self.subTest(case=case["name"]):
                actual = build_feature_vector(case["chars"])
                self.assertEqual(len(actual), FEATURE_SIZE)
                for index, (value, expected) in enumerate(zip(actual, case["expected"])):
                    self.assertTrue(math.isfinite(value), f"feature {index} is not finite")
                    self.assertAlmostEqual(value, expected, places=6, msg=f"feature {index}")


if __name__ == "__main__":
    unittest.main()
