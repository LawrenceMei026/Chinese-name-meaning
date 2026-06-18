
import json
import os

# Configuration
MODEL_DIR = '/home/wtggfv/projects/chinese-name-meaning/my-vue-app/public/models'
MANIFEST_PATH = os.path.join(MODEL_DIR, 'manifest.json')
LABELS = ['文雅', '大气', '阳刚', '柔和', '古典', '现代']
INPUT_SIZE = 16

# Ensure output directory exists
os.makedirs(MODEL_DIR, exist_ok=True)

def create_manifest():
    # Create manifest
    manifest = {
        "version": "onnx-v1",
        "modelPath": "/models/classifier.onnx",
        "inputName": "input",
        "outputName": "logits",
        "featureSize": INPUT_SIZE,
        "labels": LABELS
    }
    with open(MANIFEST_PATH, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"Manifest created: {MANIFEST_PATH}")

if __name__ == "__main__":
    create_manifest()
