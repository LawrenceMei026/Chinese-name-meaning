import json
import re
import numpy as np
import onnxruntime as ort
import os

# Paths
BASE_DIR = "/home/wtggfv/projects/chinese-name-meaning/my-vue-app"
CHARS_PATH = os.path.join(BASE_DIR, "public/data/chars.json")
SURNAMES_PATH = os.path.join(BASE_DIR, "public/data/surnames.json")
CULTURAL_PATH = os.path.join(BASE_DIR, "src/data/cultural.json")
MODEL_PATH = os.path.join(BASE_DIR, "public/models/classifier.onnx")

# Load data
with open(CHARS_PATH, 'r', encoding='utf-8') as f:
    chars_db = json.load(f)
with open(SURNAMES_PATH, 'r', encoding='utf-8') as f:
    surnames_db = json.load(f)
with open(CULTURAL_PATH, 'r', encoding='utf-8') as f:
    cultural_db = json.load(f)

ALL_LABELS = ['文雅', '大气', '阳刚', '柔和', '古典', '现代']

# Ground truth evaluation set
# Format: (name, list of expected labels)
EVAL_SET = [
    ("周杰伦", ["现代", "大气"]),
    ("李清照", ["古典", "文雅", "柔和"]),
    ("苏东坡", ["古典", "大气"]),
    ("王羲之", ["古典", "文雅"]),
    ("张三", ["现代"]),
    ("林黛玉", ["古典", "柔和", "文雅"]),
    ("诸葛亮", ["古典", "大气"]),
    ("岳飞", ["古典", "阳刚", "大气"]),
    ("陆游", ["古典", "文雅"]),
    ("辛弃疾", ["古典", "阳刚", "大气"]),
    ("纳兰性德", ["古典", "文雅", "柔和"]),
    ("林徽因", ["文雅", "柔和", "现代"]),
    ("张爱玲", ["现代", "文雅"]),
    ("鲁迅", ["现代", "阳刚"]),
    ("胡适", ["现代", "文雅"]),
    ("徐志摩", ["现代", "文雅", "柔和"]),
    ("金庸", ["现代", "古典", "大气"]),
    ("李小龙", ["阳刚", "现代"]),
    ("张国荣", ["文雅", "柔和", "现代"]),
    ("梅兰芳", ["古典", "柔和", "文雅"]),
    ("关羽", ["古典", "阳刚", "大气"]),
    ("赵云", ["古典", "阳刚", "大气"]),
    ("项羽", ["古典", "阳刚", "大气"]),
    ("刘邦", ["古典", "大气"]),
    ("武则天", ["古典", "大气"]),
    ("杨玉环", ["古典", "柔和"]),
    ("西施", ["古典", "柔和"]),
    ("貂蝉", ["古典", "柔和"]),
    ("王昭君", ["古典", "柔和"]),
    ("文天祥", ["古典", "阳刚", "文雅"]),
    ("史可法", ["古典", "阳刚"]),
    ("林则徐", ["古典", "阳刚", "大气"]),
    ("秋瑾", ["现代", "阳刚"]),
    ("谭嗣同", ["现代", "阳刚"]),
    ("汪精卫", ["现代", "文雅"]),
    ("张学良", ["现代", "大气"]),
    ("宋美龄", ["现代", "文雅", "柔和"]),
    ("宋庆龄", ["现代", "文雅", "柔和"]),
    ("马化腾", ["现代", "大气"]),
    ("张朝阳", ["现代", "大气"]),
    ("丁磊", ["现代"]),
    ("雷军", ["现代", "大气"]),
    ("李宁", ["现代", "阳刚"]),
    ("姚明", ["现代", "阳刚", "大气"]),
    ("刘翔", ["现代", "阳刚"]),
    ("徐帆", ["现代", "柔和"]),
    ("周迅", ["现代", "文雅"]),
    ("汤唯", ["现代", "文雅", "柔和"]),
    ("章子怡", ["现代", "大气"]),
    ("李健", ["文雅", "现代", "柔和"])
]

def build_feature_vector(name, chars_db, cultural_db, feature_size=16):
    # Simplified segmentation: assume first char is surname (or first two if in surnames_db)
    # But for feature extraction we need the individual characters and roles.

    # 1. Segment name
    surname = ""
    given_name = ""
    if name[:2] in surnames_db:
        surname = name[:2]
        given_name = name[2:]
    else:
        surname = name[0]
        given_name = name[1:]

    chars_info = []
    # Add surname(s)
    for c in surname:
        chars_info.append({'char': c, 'role': 'surname'})
    # Add given name chars
    for c in given_name:
        chars_info.append({'char': c, 'role': 'given'})

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

    for info in chars_info:
        c = info['char']
        cultural = cultural_db.get(c, {})
        # Look up in chars_db (key is the character)
        entry = chars_db.get(c, {})

        # Element
        elem = cultural.get('element')
        if elem == '水': counts['water'] += 1
        elif elem == '木': counts['wood'] += 1
        elif elem == '火': counts['fire'] += 1
        elif elem == '金': counts['metal'] += 1
        elif elem == '土': counts['earth'] += 1

        # Gender
        gender = cultural.get('genderBias')
        if gender == 'masculine': counts['masculine'] += 1
        elif gender == 'feminine': counts['feminine'] += 1

        # Literary
        if cultural.get('literaryRef'): counts['literary'] += 1

        # Radical
        radical = entry.get('radical', cultural.get('localGloss', ''))
        if re.search(r'[木氵山]', radical): counts['natureRadical'] += 1
        if re.search(r'[亻纟文]', radical): counts['humanRadical'] += 1
        if re.search(r'[忄力心]', radical): counts['abstractRadical'] += 1

        # Pinyin/Vowels
        pinyin = entry.get('pinyin', '').lower()
        vowels = re.findall(r'[aeoiuü]', pinyin)
        total_vowels += len(vowels)
        open_vowels += len([v for v in vowels if v in 'aeo'])

        # Tones (Simplified mapping)
        # chars.json tones is typically a string of digits
        tones_str = entry.get('tones', '0')
        current_tone = int(tones_str[0]) if tones_str and tones_str[0].isdigit() else 0
        if last_tone != -1 and current_tone > 0:
            last_ping_ze = 0 if last_tone <= 2 else 1
            current_ping_ze = 0 if current_tone <= 2 else 1
            if last_ping_ze != current_ping_ze:
                tone_changes += 1
        last_tone = current_tone
        total_freq += entry.get('freq', 5)

    num_chars = len(chars_info) or 1
    features = np.zeros(feature_size, dtype=np.float32)

    features[0] = num_chars / 4.0
    features[1] = 1.0 if len(surname) > 1 else 0.0
    features[2] = (counts['masculine'] - counts['feminine']) / num_chars

    elements = ['water', 'wood', 'fire', 'metal', 'earth']
    unique_elements = sum(1 for e in elements if counts[e] > 0)
    features[3] = unique_elements / 5.0

    features[4] = counts['literary'] / num_chars
    features[5] = counts['metal'] / num_chars
    features[6] = counts['wood'] / num_chars
    features[7] = counts['water'] / num_chars
    features[8] = counts['fire'] / num_chars
    features[9] = counts['earth'] / num_chars
    features[10] = open_vowels / total_vowels if total_vowels > 0 else 0.0
    features[11] = tone_changes / (num_chars - 1) if num_chars > 1 else 0.0
    features[12] = counts['natureRadical'] / num_chars
    features[13] = counts['humanRadical'] / num_chars
    features[14] = counts['abstractRadical'] / num_chars
    features[15] = (total_freq / num_chars) / 10.0

    return features

def evaluate():
    ort_sess = ort.InferenceSession(MODEL_PATH)

    y_true = [] # Binary matrix
    y_pred = [] # Binary matrix

    results = []

    print("\n--- Example Predictions ---")
    for name, expected in EVAL_SET:
        # Build ground truth vector
        true_vec = [1 if label in expected else 0 for label in ALL_LABELS]
        y_true.append(true_vec)

        # Inference
        features = build_feature_vector(name, chars_db, cultural_db)
        input_name = ort_sess.get_inputs()[0].name
        outputs = ort_sess.run(None, {input_name: features.reshape(1, -1)})
        logits = outputs[0][0]

        # Debug features
        if name == "周杰伦":
            print(f"DEBUG {name} Features: {features}")
            print(f"DEBUG {name} Logits: {logits}")

        # Pick top 3 like the worker does
        indexed_scores = sorted(enumerate(logits), key=lambda x: x[1], reverse=True)
        top_indices = [idx for idx, score in indexed_scores[:3]]

        pred_vec = [0] * len(ALL_LABELS)
        for idx in top_indices:
            pred_vec[idx] = 1
        y_pred.append(pred_vec)

        pred_labels = [ALL_LABELS[idx] for idx in top_indices]
        if len(results) < 5:
            print(f"Name: {name} | Expected: {expected} | Predicted: {pred_labels}")
        results.append({
            'name': name,
            'expected': expected,
            'predicted': pred_labels
        })

    y_true = np.array(y_true)
    y_pred = np.array(y_pred)

    # Metrics
    metrics = {}
    for i, label in enumerate(ALL_LABELS):
        tp = np.sum((y_true[:, i] == 1) & (y_pred[:, i] == 1))
        fp = np.sum((y_true[:, i] == 0) & (y_pred[:, i] == 1))
        fn = np.sum((y_true[:, i] == 1) & (y_pred[:, i] == 0))

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

        metrics[label] = {
            'precision': precision,
            'recall': recall,
            'f1': f1
        }

    # Macro Average
    macro_f1 = np.mean([m['f1'] for m in metrics.values()])
    macro_prec = np.mean([m['precision'] for m in metrics.values()])
    macro_rec = np.mean([m['recall'] for m in metrics.values()])

    # Micro Average
    total_tp = np.sum((y_true == 1) & (y_pred == 1))
    total_fp = np.sum((y_true == 0) & (y_pred == 1))
    total_fn = np.sum((y_true == 1) & (y_pred == 0))
    micro_prec = total_tp / (total_tp + total_fp)
    micro_rec = total_tp / (total_tp + total_fn)
    micro_f1 = 2 * micro_prec * micro_rec / (micro_prec + micro_rec)

    # Accuracy
    exact_match = np.all(y_true == y_pred, axis=1).mean()
    hamming_score = np.sum(y_true & y_pred) / np.sum(y_true | y_pred)

    # Print results
    print(f"| Label | Precision | Recall | F1-Score |")
    print(f"|-------|-----------|--------|----------|")
    for label in ALL_LABELS:
        m = metrics[label]
        print(f"| {label} | {m['precision']:.3f} | {m['recall']:.3f} | {m['f1']:.3f} |")

    print(f"\n| Metric | Value |")
    print(f"|--------|-------|")
    print(f"| Macro F1 | {macro_f1:.3f} |")
    print(f"| Micro F1 | {micro_f1:.3f} |")
    print(f"| Exact Match Ratio | {exact_match:.3f} |")
    print(f"| Hamming Score | {hamming_score:.3f} |")

if __name__ == "__main__":
    evaluate()
