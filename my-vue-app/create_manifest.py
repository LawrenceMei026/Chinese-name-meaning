
import json
from pathlib import Path

from feature_extractor import FEATURE_CONTRACT, FEATURE_SIZE

MODEL_DIR = Path(__file__).resolve().parent / 'public/models'
MANIFEST_PATH = MODEL_DIR / 'manifest.json'
LABELS = ['书卷', '宏伟', '豪迈', '恬静', '典雅', '新颖', '灵动', '坚毅', '自然', '深邃']

def create_manifest():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": "onnx-v1",
        "modelPath": "/models/classifier.onnx",
        "inputName": "input",
        "outputName": "logits",
        "featureSize": FEATURE_SIZE,
        "featureContractVersion": FEATURE_CONTRACT["version"],
        "labels": LABELS
    }
    with MANIFEST_PATH.open('w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"Manifest created: {MANIFEST_PATH}")

if __name__ == "__main__":
    create_manifest()
