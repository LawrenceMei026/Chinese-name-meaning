import json
import re
import requests
import random
import os

# Paths (absolute paths based on the environment info)
PROJECT_ROOT = "/home/wtggfv/projects/chinese-name-meaning"
CHARS_PATH = f"{PROJECT_ROOT}/my-vue-app/public/data/chars.json"
CULTURAL_PATH = f"{PROJECT_ROOT}/my-vue-app/src/data/cultural.json"
SURNAMES_PATH = f"{PROJECT_ROOT}/my-vue-app/public/data/surnames.json"
OUTPUT_PATH = "training_data.json"

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL_NAME = "qwen2.5"

def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def build_feature_vector(name, chars_data, cultural_data, surnames_data, feature_size=16):
    """
    Python implementation of buildFeatureVector from localInference.worker.ts.
    Ensures 1:1 matching of logic.
    """
    counts = {
        'water': 0, 'wood': 0, 'fire': 0, 'metal': 0, 'earth': 0,
        'masculine': 0, 'feminine': 0,
        'literary': 0,
        'natureRadical': 0,  # 木氵山
        'humanRadical': 0,   # 亻纟文
        'abstractRadical': 0  # 忄力心
    }

    total_vowels = 0
    open_vowels = 0
    tone_changes = 0
    last_tone = -1
    total_freq = 0

    surname = name[0]
    given_name = name[1:]

    chars_list = []
    chars_list.append({'char': surname, 'role': 'surname'})
    for char in given_name:
        chars_list.append({'char': char, 'role': 'given'})

    for i, item in enumerate(chars_list):
        char = item['char']
        role = item['role']

        entry = chars_data.get(char)
        cultural = cultural_data.get(char)

        if cultural:
            element = cultural.get('element')
            if element == '水': counts['water'] += 1
            if element == '木': counts['wood'] += 1
            if element == '火': counts['fire'] += 1
            if element == '金': counts['metal'] += 1
            if element == '土': counts['earth'] += 1

            gender = cultural.get('genderBias')
            if gender == 'masculine': counts['masculine'] += 1
            if gender == 'feminine': counts['feminine'] += 1

            if cultural.get('literaryRef'): counts['literary'] += 1

        radical = ""
        if entry and entry.get('radical'):
            radical = entry['radical']
        elif cultural and cultural.get('localGloss'):
            radical = cultural['localGloss']

        if re.search(r'[木氵山]', radical): counts['natureRadical'] += 1
        if re.search(r'[亻纟文]', radical): counts['humanRadical'] += 1
        if re.search(r'[忄力心]', radical): counts['abstractRadical'] += 1

        pinyin = ""
        if entry:
            pinyin = entry.get('pinyin', '').lower()

        vowels = re.findall(r'[aeoiuü]', pinyin)
        total_vowels += len(vowels)
        open_vowels += len([v for v in vowels if v in 'aeo'])

        tones_str = "0"
        if entry:
            tones_str = entry.get('tones', '0')

        try:
            current_tone = int(tones_str)
        except:
            current_tone = 0

        if last_tone != -1 and current_tone > 0:
            last_ping_ze = 0 if last_tone <= 2 else 1
            current_ping_ze = 0 if current_tone <= 2 else 1
            if last_ping_ze != current_ping_ze:
                tone_changes += 1
        last_tone = current_tone

        freq = entry.get('freq', 5) if entry else 5
        total_freq += freq

    length = len(chars_list)
    features = [0.0] * feature_size

    features[0] = length / 4.0
    is_double_surname = 1.0 if name[:2] in surnames_data and len(name) > 2 else 0.0
    features[1] = is_double_surname
    features[2] = (counts['masculine'] - counts['feminine']) / length

    unique_elements = sum(1 for k in ['water', 'wood', 'fire', 'metal', 'earth'] if counts[k] > 0)
    features[3] = unique_elements / 5.0

    features[4] = counts['literary'] / length
    features[5] = counts['metal'] / length
    features[6] = counts['wood'] / length
    features[7] = counts['water'] / length
    features[8] = counts['fire'] / length
    features[9] = counts['earth'] / length
    features[10] = open_vowels / total_vowels if total_vowels > 0 else 0.0
    features[11] = tone_changes / (length - 1) if length > 1 else 0.0
    features[12] = counts['natureRadical'] / length
    features[13] = counts['humanRadical'] / length
    features[14] = counts['abstractRadical'] / length
    features[15] = (total_freq / length) / 10.0

    return features

def get_ollama_labels(name, chars_data, cultural_data):
    context_parts = []
    for char in name:
        entry = chars_data.get(char, {})
        cultural = cultural_data.get(char, {})
        meaning = entry.get('definition_cn', '未知')
        radical = entry.get('radical', cultural.get('localGloss', '未知'))
        connotation = cultural.get('connotation', '暂无')
        tags = []
        if cultural.get('element'): tags.append(f"五行:{cultural['element']}")
        if cultural.get('genderBias'): tags.append(f"性别倾向:{cultural['genderBias']}")
        context_parts.append(f"- 字符: {char}\n  含义: {meaning}\n  部首: {radical}\n  文化内涵: {connotation}\n  标签: {', '.join(tags)}")

    context_str = "\n".join(context_parts)
    prompt = f"""分析以下中国名字的风格，并返回1到3个标签。
可选标签：文雅, 大气, 阳刚, 柔和,古典, 现代。

定义指南：
- 大气：格局宏大，志向远大（如：海、天、宇宙、宏、博）。
- 阳刚：力量，强健，刚硬（如：强、勇、刚、毅、武）。
- 文雅：书卷气，才华，儒雅（如：书、墨、文、才、雅、韵）。
- 柔和：温柔，包容，细腻（如：润、玉、柔、婉、细）。
- 古典：具有传统文化韻味，常出自经史子集。
- 现代：简洁，清新，具有时代感。

名字：{name}
组成分析：
{context_str}

请仅以 JSON 格式返回，格式如下：
{{"labels": ["标签1", "标签2"]}}
"""

    try:
        response = requests.post(OLLAMA_URL, json={
            "model": MODEL_NAME,
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "stream": False,
            "format": "json"
        }, timeout=120)

        if response.status_code == 200:
            result = response.json()
            content = result.get('message', {}).get('content', '{}')
            if "```json" in content:
                match = re.search(r"```json\s*(\{.*?\})\s*```", content, re.DOTALL)
                if match: content = match.group(1)
            labels_data = json.loads(content)
            return labels_data.get('labels', [])
        else:
            print(f"Ollama error {response.status_code} for {name}")
            return []
    except Exception as e:
        print(f"Error calling Ollama for {name}: {e}")
        return []

def check_ollama():
    try:
        response = requests.get("http://localhost:11434/api/tags", timeout=5)
        return response.status_code == 200
    except:
        return False

def main():
    if not check_ollama():
        print("Error: Ollama is not running on localhost:11434")
        return

    print("Loading data...")
    chars_data = load_json(CHARS_PATH)
    cultural_data = load_json(CULTURAL_PATH)
    surnames_data = load_json(SURNAMES_PATH)

    common_surnames = ["张", "王", "李", "赵", "陈", "刘", "林", "周", "吴", "徐"]
    name_pool = list(cultural_data.keys())
    if not name_pool:
        name_pool = ["伟", "芳", "杰", "敏", "涛", "静", "强", "丽", "艳", "军"]

    training_data = []
    sample_size = 50
    print(f"Generating and annotating {sample_size} names...")

    for i in range(sample_size):
        surname = random.choice(common_surnames)
        given_len = random.randint(1, 2)
        given_name = "".join(random.sample(name_pool, given_len))
        full_name = surname + given_name

        print(f"Processing ({i+1}/{sample_size}): {full_name}")
        features = build_feature_vector(full_name, chars_data, cultural_data, surnames_data)
        labels = get_ollama_labels(full_name, chars_data, cultural_data)

        if labels:
            training_data.append({
                "name": full_name,
                "features": features,
                "labels": labels
            })
            print(f"  Labels: {labels}")
        else:
            print(f"  Skipped (no labels)")

    print(f"Saving {len(training_data)} samples to {OUTPUT_PATH}...")
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(training_data, f, ensure_ascii=False, indent=2)

    print("Done!")

if __name__ == "__main__":
    main()
