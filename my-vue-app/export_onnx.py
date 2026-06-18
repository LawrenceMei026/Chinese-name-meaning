import json
import torch
import torch.nn as nn
import os
import sys

# Constants matching train_model.py
LABELS = ['文雅', '大气', '阳刚', '柔和', '古典', '现代']
INPUT_SIZE = 16
OUTPUT_SIZE = len(LABELS)
MODEL_DIR = '/home/wtggfv/projects/chinese-name-meaning/my-vue-app/public/models'
ONNX_PATH = os.path.join(MODEL_DIR, 'classifier.onnx')

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

def export():
    print("Initializing model...")
    model = NameClassifier(INPUT_SIZE, OUTPUT_SIZE)
    model.eval()

    # Use a fixed seed for deterministic initialization since we can't train
    torch.manual_seed(42)

    print(f"Exporting to ONNX (legacy mode): {ONNX_PATH}")
    os.makedirs(MODEL_DIR, exist_ok=True)

    dummy_input = torch.randn(1, INPUT_SIZE)

    # We use the legacy exporter by setting check_trace=False or just calling it
    # Pytorch 2.x often defaults to the new exporter which requires onnxscript
    try:
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
        print("Export successful.")
    except Exception as e:
        print(f"Export failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    export()
