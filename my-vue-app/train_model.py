import json
import random
import os
import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np

from feature_extractor import FEATURE_CONTRACT, FEATURE_SIZE, build_feature_vector as extract_feature_vector

RANDOM_SEED = 20260728

# 扩展后的 10 个差异化标签
LABELS = [
    '书卷', '宏伟', '豪迈', '恬静',
    '典雅', '新颖', '灵动', '坚毅',
    '自然', '深邃'
]

# 资源路径
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHARS_PATH = os.path.join(BASE_DIR, "public/data/chars.json")
CULTURAL_PATH = os.path.join(BASE_DIR, "src/data/cultural.json")

def load_data_files():
    with open(CHARS_PATH, 'r', encoding='utf-8') as f:
        chars_data = json.load(f)
    with open(CULTURAL_PATH, 'r', encoding='utf-8') as f:
        cultural_data = json.load(f)
    return chars_data, cultural_data

chars_dict, cultural_dict = load_data_files()

def build_feature_vector(name_chars):
    chars = [
        {
            'char': char,
            'role': 'given',
            'entry': chars_dict.get(char),
            'cultural': cultural_dict.get(char),
        }
        for char in name_chars
    ]
    return np.asarray(extract_feature_vector(chars), dtype=np.float32)

# 针对 10 个标签的语料池
POOLS = {
    '书卷': ['翰', '书', '墨', '雅', '文', '博', '思', '远', '嘉', '哲', '韵', '谦', '修', '德', '清', '贤'],
    '宏伟': ['宇', '宙', '瀚', '海', '天', '乾', '坤', '鹏', '宏', '霄', '浩', '广', '阔', '疆', '泰', '鹏'],
    '豪迈': ['龙', '虎', '啸', '骁', '猛', '锐', '傲', '凌', '风', '云', '腾', '飞', '霄', '剑', '昂', '壮'],
    '恬静': ['婉', '柔', '静', '悦', '梦', '茹', '薇', '洁', '恬', '琳', '曼', '芊', '淑', '安', '宁', '悠'],
    '典雅': ['子', '墨', '轩', '逸', '若', '望', '归', '词', '赋', '朝', '礼', '仪', '正', '纯', '质', '真'],
    '新颖': ['希', '语', '涵', '奕', '凡', '诺', '星', '熙', '芮', '沐', '可', '乐', '予', '其', '于', '也'],
    '灵动': ['舒', '悠', '然', '悦', '灵', '颖', '芸', '羽', '翔', '逸', '流', '光', '影', '旋', '舞', '翩'],
    '坚毅': ['刚', '强', '勇', '健', '毅', '峰', '军', '武', '力', '锋', '威', '定', '松', '柏', '岩', '钧'],
    '自然': ['山', '川', '岳', '林', '森', '沐', '汐', '阳', '月', '雪', '云', '雨', '溪', '木', '禾', '竹'],
    '深邃': ['远', '幽', '潜', '深', '玄', '微', '妙', '默', '思', '冥', '理', '道', '索', '究', '渊', '鉴']
}

def generate_dataset(num_records=2000):
    X, y = [], []
    per_class = num_records // len(LABELS)
    for label_idx, label_name in enumerate(LABELS):
        pool = POOLS[label_name]
        for _ in range(per_class):
            name_len = random.randint(1, 2)
            name = "".join(random.choices(pool, k=name_len))
            features = build_feature_vector(name)

            label_vec = np.zeros(len(LABELS), dtype=np.float32)
            label_vec[label_idx] = 1.0

            # 交叉标签注入
            for other_idx, other_name in enumerate(LABELS):
                if other_idx == label_idx: continue
                if any(c in POOLS[other_name] for c in name):
                    label_vec[other_idx] += 0.4

            X.append(features)
            y.append(label_vec)
    return np.array(X), np.array(y)

class NameClassifier(nn.Module):
    def __init__(self):
        super(NameClassifier, self).__init__()
        self.net = nn.Sequential(
            nn.Linear(FEATURE_SIZE, 64),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, len(LABELS)),
            nn.Sigmoid()
        )
    def forward(self, x):
        return self.net(x)

def train():
    random.seed(RANDOM_SEED)
    np.random.seed(RANDOM_SEED)
    torch.manual_seed(RANDOM_SEED)

    raw_X, raw_y = generate_dataset(3000)
    indices = np.arange(len(raw_X))
    np.random.shuffle(indices)
    raw_X, raw_y = raw_X[indices], raw_y[indices]

    split = int(0.9 * len(raw_X))
    train_X, test_X = torch.FloatTensor(raw_X[:split]), torch.FloatTensor(raw_X[split:])
    train_y, test_y = torch.FloatTensor(raw_y[:split]), torch.FloatTensor(raw_y[split:])

    model = NameClassifier()
    criterion = nn.BCELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.003)

    epochs = 600
    for epoch in range(epochs):
        model.train()
        optimizer.zero_grad()
        outputs = model(train_X)
        loss = criterion(outputs, train_y)
        loss.backward()
        optimizer.step()
        if (epoch + 1) % 100 == 0:
            print(f"Epoch {epoch+1}, Loss: {loss.item():.4f}")

    onnx_path = os.path.join(BASE_DIR, "public/models/classifier.onnx")
    model.eval()
    dummy_input = torch.randn(1, FEATURE_SIZE)
    torch.onnx.export(
        model, dummy_input, onnx_path,
        export_params=True, opset_version=12,
        input_names=['input'], output_names=['logits'],
        dynamic_axes={'input': {0: 'batch_size'}, 'logits': {0: 'batch_size'}},
        dynamo=False,
    )

    # 强制将权重内联到单一 ONNX 文件中
    import onnx
    onnx_model = onnx.load(onnx_path)
    del onnx_model.metadata_props[:]
    metadata = onnx_model.metadata_props.add()
    metadata.key = 'feature_contract_version'
    metadata.value = FEATURE_CONTRACT['version']
    onnx.save_model(onnx_model, onnx_path, save_as_external_data=False)

    print(f"Model exported to {onnx_path} with inlined weights")

if __name__ == "__main__":
    train()
