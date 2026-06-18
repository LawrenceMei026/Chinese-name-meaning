
import json
import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
import os

# Configuration
DATA_PATH = '/home/wtggfv/projects/chinese-name-meaning/my-vue-app/training_data.json'
MODEL_DIR = '/home/wtggfv/projects/chinese-name-meaning/my-vue-app/public/models'
ONNX_PATH = os.path.join(MODEL_DIR, 'classifier.onnx')
MANIFEST_PATH = os.path.join(MODEL_DIR, 'manifest.json')
LABELS = ['文雅', '大气', '阳刚', '柔和', '古典', '现代']
INPUT_SIZE = 16
OUTPUT_SIZE = len(LABELS)

# Ensure output directory exists
os.makedirs(MODEL_DIR, exist_ok=True)

class NameClassifier(nn.Module):
    def __init__(self, input_size, output_size):
        super(NameClassifier, self).__init__()
        self.network = nn.Sequential(
            nn.Linear(input_size, 32),
            nn.ReLU(),
            nn.Linear(32, 16),
            nn.ReLU(),
            nn.Linear(16, output_size),
            nn.Sigmoid()
        )

    def forward(self, x):
        return self.network(x)

def load_data(path):
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    X = []
    y = []

    label_to_idx = {label: i for i, label in enumerate(LABELS)}

    for item in data:
        X.append(item['features'])

        target = [0.0] * OUTPUT_SIZE
        for label in item['labels']:
            if label in label_to_idx:
                target[label_to_idx[label]] = 1.0
        y.append(target)

    return torch.FloatTensor(X), torch.FloatTensor(y)

def train():
    print("Loading data...")
    X, y = load_data(DATA_PATH)
    print(f"Loaded {len(X)} samples.")

    model = NameClassifier(INPUT_SIZE, OUTPUT_SIZE)
    criterion = nn.BCELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.001)

    epochs = 200
    print(f"Training for {epochs} epochs...")
    for epoch in range(epochs):
        optimizer.zero_grad()
        outputs = model(X)
        loss = criterion(outputs, y)
        loss.backward()
        optimizer.step()

        if (epoch + 1) % 20 == 0:
            print(f'Epoch [{epoch+1}/{epochs}], Loss: {loss.item():.4f}')

    print("Training complete.")

    # Export to ONNX
    print(f"Exporting to ONNX: {ONNX_PATH}")
    model.eval()
    dummy_input = torch.randn(1, INPUT_SIZE)
    torch.onnx.export(
        model,
        dummy_input,
        ONNX_PATH,
        export_params=True,
        opset_version=12,
        do_constant_folding=True,
        input_names=['input'],
        output_names=['logits'],
        dynamic_axes={'input': {0: 'batch_size'}, 'logits': {0: 'batch_size'}}
    )

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
    train()
