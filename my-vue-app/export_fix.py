import torch
import torch.nn as nn
import json
import os

# 定义与训练时一致的模型结构
class NameClassifier(nn.Module):
    def __init__(self, input_size=16, num_labels=6):
        super(NameClassifier, self).__init__()
        self.network = nn.Sequential(
            nn.Linear(input_size, 32),
            nn.ReLU(),
            nn.Linear(32, 16),
            nn.ReLU(),
            nn.Linear(16, num_labels),
            nn.Sigmoid()
        )

    def forward(self, x):
        return self.network(x)

def export():
    model = NameClassifier()
    # 尝试加载可能已保存的权重，如果没有则随机初始化（作为测试）
    # 如果你有 checkpoint，请取消下面注释
    # model.load_state_dict(torch.load('model_checkpoint.pth'))
    model.eval()

    dummy_input = torch.randn(1, 16)
    onnx_path = 'my-vue-app/public/models/classifier.onnx'
    
    os.makedirs(os.path.dirname(onnx_path), exist_ok=True)

    print(f"Exporting to ONNX using legacy path...")
    torch.onnx.export(
        model,
        dummy_input,
        onnx_path,
        export_params=True,
        opset_version=17,  # 使用更高的版本避开转换器 Bug
        do_constant_folding=True,
        input_names=['input'],
        output_names=['logits']
    )
    print(f"Model exported to: {onnx_path}")

if __name__ == "__main__":
    export()
