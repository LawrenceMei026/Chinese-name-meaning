import json
import random
import os
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import numpy as np

# Labels
LABELS = ['文雅', '大气', '阳刚', '柔和', '古典', '现代']

# Character data loaders
def load_data_files():
    base_dir = "/home/wtggfv/projects/chinese-name-meaning/my-vue-app"
    with open(os.path.join(base_dir, "public/data/chars.json"), 'r', encoding='utf-8') as f:
        chars_data = json.load(f)
    with open(os.path.join(base_dir, "src/data/cultural.json"), 'r', encoding='utf-8') as f:
        cultural_data = json.load(f)
    return chars_data, cultural_data

chars_dict, cultural_dict = load_data_files()

def get_char_info(char):
    entry = chars_dict.get(char, {})
    cultural = cultural_dict.get(char, {})
    return entry, cultural

def build_feature_vector(name_chars):
    # Match JS logic in localInference.worker.ts
    counts = {
        'water': 0, 'wood': 0, 'fire': 0, 'metal': 0, 'earth': 0,
        'masculine': 0, 'feminine': 0,
        'literary': 0,
        'natureRadical': 0,
        'humanRadical': 0,
        'abstractRadical': 0
    }

    total_vowels = 0
    open_vowels = 0
    tone_changes = 0
    last_tone = -1
    total_freq = 0

    for char in name_chars:
        entry, cultural = get_char_info(char)

        if cultural.get('element') == '水': counts['water'] += 1
        if cultural.get('element') == '木': counts['wood'] += 1
        if cultural.get('element') == '火': counts['fire'] += 1
        if cultural.get('element') == '金': counts['metal'] += 1
        if cultural.get('element') == '土': counts['earth'] += 1

        gender = cultural.get('genderBias')
        if gender == 'masculine': counts['masculine'] += 1
        elif gender == 'feminine': counts['feminine'] += 1

        if cultural.get('literaryRef'): counts['literary'] += 1

        radical = entry.get('radical') or cultural.get('localGloss', '')
        if any(r in radical for r in '木氵山'): counts['natureRadical'] += 1
        if any(r in radical for r in '亻纟文'): counts['humanRadical'] += 1
        if any(r in radical for r in '忄力心'): counts['abstractRadical'] += 1

        pinyin = entry.get('pinyin', '').lower()
        vowels = [c for c in pinyin if c in 'aeoiuü']
        total_vowels += len(vowels)
        open_vowels += sum(1 for v in vowels if v in 'aeo')

        try:
            tones_str = str(entry.get('tones', '0'))
            current_tone = int(tones_str[0]) if tones_str else 0
        except:
            current_tone = 0

        if last_tone != -1 and current_tone > 0:
            last_pz = 0 if last_tone <= 2 else 1
            curr_pz = 0 if current_tone <= 2 else 1
            if last_pz != curr_pz:
                tone_changes += 1
        last_tone = current_tone
        total_freq += entry.get('freq', 5)

    length = len(name_chars) or 1
    features = np.zeros(16, dtype=np.float32)

    features[0] = length / 4
    features[1] = 0 # Surname logic (ignoring for now as we generate single names or simple pairs)
    features[2] = (counts['masculine'] - counts['feminine']) / length

    unique_elements = sum(1 for k in ['water', 'wood', 'fire', 'metal', 'earth'] if counts[k] > 0)
    features[3] = unique_elements / 5

    features[4] = counts['literary'] / length
    features[5] = counts['metal'] / length
    features[6] = counts['wood'] / length
    features[7] = counts['water'] / length
    features[8] = counts['fire'] / length
    features[9] = counts['earth'] / length
    features[10] = open_vowels / total_vowels if total_vowels > 0 else 0
    features[11] = tone_changes / (length - 1) if length > 1 else 0
    features[12] = counts['natureRadical'] / length
    features[13] = counts['humanRadical'] / length
    features[14] = counts['abstractRadical'] / length
    features[15] = (total_freq / length) / 10

    return features

# Keyword pools for generation
POOLS = {
    '大气': ['宇', '宙', '瀚', '海', '天', '乾', '坤', '鹏', '宏', '霄', '川', '岳', '博', '浩', '广', '峻', '巍', '昂', '阔'],
    '阳刚': ['龙', '虎', '刚', '强', '勇', '健', '毅', '峰', '军', '武', '力', '锋', '威', '壮', '啸', '骁', '猛', '锐', '傲'],
    '文雅': ['翰', '书', '墨', '雅', '文', '博', '思', '远', '嘉', '哲', '韵', '谦', '修', '德', '清', '心', '逸', '儒', '贤'],
    '柔和': ['婉', '柔', '静', '雅', '悦', '梦', '茹', '薇', '洁', '恬', '琳', '曼', '芊', '淑', '柔', '宁', '灵', '颖', '芸'],
    '古典': ['子', '墨', '轩', '逸', '离', '白', '青', '长', '苏', '秦', '楚', '若', '望', '归', '年', '时', '词', '赋', '朝'],
    '现代': ['子', '一', '晨', '曦', '俊', '铭', '灏', '冉', '睿', '语', '涵', '奕', '凡', '诺', '星', '宇', '洋', '鸣', '熙']
}

def generate_dataset(num_records=720):
    data = []
    labels_list = []

    per_class = num_records // len(LABELS)

    for label_idx, label_name in enumerate(LABELS):
        pool = POOLS[label_name]
        for _ in range(per_class):
            name_len = random.randint(1, 2)
            name = "".join(random.choices(pool, k=name_len))
            features = build_feature_vector(name)

            label_vec = np.zeros(len(LABELS), dtype=np.float32)
            label_vec[label_idx] = 1.0

            # Heuristic additions
            for other_idx, other_name in enumerate(LABELS):
                if other_idx == label_idx: continue
                if any(c in POOLS[other_name] for c in name):
                    label_vec[other_idx] = 0.5

            data.append(features)
            labels_list.append(label_vec)

    return np.array(data), np.array(labels_list)

class NameClassifier(nn.Module):
    def __init__(self):
        super(NameClassifier, self).__init__()
        self.net = nn.Sequential(
            nn.Linear(16, 64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, 6),
            nn.Sigmoid()
        )

    def forward(self, x):
        return self.net(x)

def train():
    raw_X, raw_y = generate_dataset(1200) # Increased dataset size

    indices = np.arange(len(raw_X))
    np.random.shuffle(indices)
    raw_X, raw_y = raw_X[indices], raw_y[indices]

    split = int(0.9 * len(raw_X))
    train_X, test_X = torch.FloatTensor(raw_X[:split]), torch.FloatTensor(raw_X[split:])
    train_y, test_y = torch.FloatTensor(raw_y[:split]), torch.FloatTensor(raw_y[split:])

    model = NameClassifier()
    # Binary Cross Entropy for multi-label classification
    criterion = nn.BCELoss()
    optimizer = optim.Adam(model.parameters(), lr=0.005)

    epochs = 400
    for epoch in range(epochs):
        model.train()
        optimizer.zero_grad()
        outputs = model(train_X)
        loss = criterion(outputs, train_y)
        loss.backward()
        optimizer.step()

        if (epoch + 1) % 100 == 0:
            model.eval()
            with torch.no_grad():
                test_outputs = model(test_X)
                test_loss = criterion(test_outputs, test_y)
                print(f"Epoch {epoch+1}, Loss: {loss.item():.4f}, Test Loss: {test_loss.item():.4f}")

    # Export to ONNX
    model.eval()
    dummy_input = torch.randn(1, 16)
    onnx_path = "/home/wtggfv/projects/chinese-name-meaning/my-vue-app/public/models/classifier.onnx"
    torch.onnx.export(
        model,
        dummy_input,
        onnx_path,
        export_params=True,
        opset_version=12,
        do_constant_folding=True,
        input_names=['input'],
        output_names=['logits'],
        dynamic_axes={'input': {0: 'batch_size'}, 'logits': {0: 'batch_size'}}
    )
    print(f"Exported model to {onnx_path}")

    # Performance Report
    model.eval()
    with torch.no_grad():
        test_outputs = model(test_X)
        preds = (test_outputs > 0.4).float() # Slightly lower threshold for recall
        print("\n--- Final Performance Report ---")
        for i, label in enumerate(LABELS):
            tp = ((preds[:, i] == 1) & (test_y[:, i] >= 0.5)).sum().item()
            fp = ((preds[:, i] == 1) & (test_y[:, i] < 0.5)).sum().item()
            fn = ((preds[:, i] == 0) & (test_y[:, i] >= 0.5)).sum().item()
            precision = tp / (tp + fp) if (tp + fp) > 0 else 0
            recall = tp / (tp + fn) if (tp + fn) > 0 else 0
            f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
            print(f"{label}: Precision={precision:.2f}, Recall={recall:.2f}, F1-Score={f1:.4f}")

if __name__ == "__main__":
    train()
