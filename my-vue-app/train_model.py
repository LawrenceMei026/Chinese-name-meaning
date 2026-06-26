import json
import random
import os
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import numpy as np
import re

# 扩展后的 10 个差异化标签
LABELS = [
    '书卷', '宏伟', '豪迈', '恬静',
    '典雅', '新颖', '灵动', '坚毅',
    '自然', '深邃'
]

# 资源路径
BASE_DIR = "/home/wtggfv/projects/chinese-name-meaning/my-vue-app"
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
    # 与 localInference.worker.ts 的优化逻辑同步
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
    strong_initials = 0

    # 语义得分
    semantic_scores = {'beauty': 0, 'strength': 0, 'virtue': 0, 'nature': 0}

    for char in name_chars:
        entry = chars_dict.get(char, {})
        cultural = cultural_dict.get(char, {})

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

        # 语义扫描
        def_cn = entry.get('definition_cn', '')
        if any(r in def_cn for r in '美秀丽华雅'): semantic_scores['beauty'] += 1
        if any(r in def_cn for r in '强刚劲力伟'): semantic_scores['strength'] += 1
        if any(r in def_cn for r in '德贤善诚礼'): semantic_scores['virtue'] += 1
        if any(r in def_cn for r in '山川云雨林'): semantic_scores['nature'] += 1

        pinyin = entry.get('pinyin', '').lower()
        # 塞音特征
        initials = pinyin.split('a')[0].split('e')[0].split('i')[0].split('o')[0].split('u')[0].split('ü')[0]
        if any(r in initials for r in 'bpdkgt'): strong_initials += 1

        vowels = [c for c in pinyin if c in 'aeoiuü']
        total_vowels += len(vowels)
        open_vowels += sum(1 for v in vowels if v in 'aeo')

        tones_str = str(entry.get('tones', '0'))
        current_tone = int(tones_str[0]) if tones_str and tones_str[0].isdigit() else 0
        if last_tone != -1 and current_tone > 0:
            last_pz = 0 if last_tone <= 2 else 1
            curr_pz = 0 if current_tone <= 2 else 1
            if last_pz != curr_pz: tone_changes += 1
        last_tone = current_tone
        total_freq += entry.get('freq', 5)

    length = len(name_chars) or 1
    features = np.zeros(16, dtype=np.float32)

    features[0] = length / 4
    features[1] = 0
    features[2] = (counts['masculine'] - counts['feminine']) / length
    features[3] = sum(1 for k in ['water', 'wood', 'fire', 'metal', 'earth'] if counts[k] > 0) / 5
    features[4] = counts['literary'] / length
    features[5] = counts['metal'] / length
    features[6] = counts['wood'] / length
    features[7] = counts['water'] / length
    features[8] = counts['fire'] / length
    features[9] = counts['earth'] / length
    features[10] = open_vowels / total_vowels if total_vowels > 0 else 0
    features[11] = tone_changes / (length - 1) if length > 1 else 0

    # 融合特征
    features[12] = (counts['natureRadical'] / length + (semantic_scores['nature'] / length)) / 2
    features[13] = (counts['humanRadical'] / length + (semantic_scores['virtue'] / length)) / 2
    features[14] = (counts['abstractRadical'] / length + (semantic_scores['strength'] / length)) / 2
    features[15] = (strong_initials / length) * 0.4 + (semantic_scores['beauty'] / length) * 0.6

    return features

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
            nn.Linear(16, 64),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, 10), # 输出 10 维
            nn.Sigmoid()
        )
    def forward(self, x):
        return self.net(x)

def train():
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
    dummy_input = torch.randn(1, 16)
    torch.onnx.export(
        model, dummy_input, onnx_path,
        export_params=True, opset_version=12,
        input_names=['input'], output_names=['logits'],
        dynamic_axes={'input': {0: 'batch_size'}, 'logits': {0: 'batch_size'}}
    )
    print(f"Model exported to {onnx_path}")

if __name__ == "__main__":
    train()
