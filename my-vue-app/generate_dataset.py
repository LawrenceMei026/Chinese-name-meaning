import json
import re

def build_feature_vector(name, chars_data, cultural_data, feature_size=16):
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
    
    analyzed_chars = []
    
    # Simple split: first char is surname, rest are given
    # (Handling double-char surnames would be better but for synthetic data this is ok)
    for i, char in enumerate(name):
        role = 'surname' if i == 0 else 'given'
        entry = chars_data.get(char)
        cultural = cultural_data.get(char)
        
        if cultural:
            elem = cultural.get('element')
            if elem == '水': counts['water'] += 1
            if elem == '木': counts['wood'] += 1
            if elem == '火': counts['fire'] += 1
            if elem == '金': counts['metal'] += 1
            if elem == '土': counts['earth'] += 1
            
            gb = cultural.get('genderBias')
            if gb == 'masculine': counts['masculine'] += 1
            if gb == 'feminine': counts['feminine'] += 1
            
            if cultural.get('literaryRef'): counts['literary'] += 1
            
            radical = (entry.get('radical') if entry else None) or cultural.get('localGloss') or ''
            if re.search('[木氵山]', radical): counts['natureRadical'] += 1
            if re.search('[亻纟文]', radical): counts['humanRadical'] += 1
            if re.search('[忄力心]', radical): counts['abstractRadical'] += 1

        if entry:
            py = entry.get('pinyin', '').lower()
            vowels = re.findall('[aeoiuü]', py)
            total_vowels += len(vowels)
            open_vowels += len([v for v in vowels if v in 'aeo'])
            
            current_tone = int(entry.get('tones', '0'))
            if last_tone != -1 and current_tone > 0:
                last_pz = 0 if last_tone <= 2 else 1
                curr_pz = 0 if current_tone <= 2 else 1
                if last_pz != curr_pz:
                    tone_changes += 1
            last_tone = current_tone
            total_freq += entry.get('freq', 5)
        else:
            total_freq += 5

    length = len(name)
    features = [0.0] * feature_size
    
    features[0] = length / 4.0
    features[1] = 0.0 # simplified: no compound surnames in auto-gen for now
    features[2] = (counts['masculine'] - counts['feminine']) / length
    
    unique_elems = sum(1 for k in ['water', 'wood', 'fire', 'metal', 'earth'] if counts[k] > 0)
    features[3] = unique_elems / 5.0
    
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
    features[15] = (total_freq / length) / 10.0
    
    return features

# Load data
with open('/home/wtggfv/projects/chinese-name-meaning/my-vue-app/public/data/chars.json', 'r') as f:
    chars = json.load(f)
with open('/home/wtggfv/projects/chinese-name-meaning/my-vue-app/src/data/cultural.json', 'r') as f:
    cultural = json.load(f)
with open('/home/wtggfv/projects/chinese-name-meaning/my-vue-app/public/data/surnames.json', 'r') as f:
    surnames_map = json.load(f)

common_surnames = list(surnames_map.keys())[:20]

# Selection of characters for synthetic generation
# We categorize them to help generate varied names
pool = {
    '大气': ['海', '山', '天', '宇', '瀚', '浩', '宏', '远', '博', '鹏', '峰', '阔', '大', '苍', '龙'],
    '文雅': ['文', '墨', '翰', '书', '雅', '清', '思', '修', '哲', '韵', '才', '儒', '谦', '敏', '学'],
    '阳刚': ['强', '伟', '勇', '刚', '猛', '凯', '毅', '峰', '建', '军', '志', '武', '力', '震', '彪'],
    '柔和': ['婉', '柔', '静', '雅', '梦', '雪', '月', '雨', '灵', '洁', '心', '恬', '宁', '淑', '惠'],
    '古典': ['子', '夫', '之', '若', '如', '德', '仁', '礼', '卿', '玄', '灵', '逸', '白', '苏', '墨'],
    '现代': ['然', '一', '诺', '沐', '宸', '梓', '睿', '语', '予', '曦', '辰', '奕', '凡', '宇', '泽'],
}

generated = []
# Ensure unique names
seen = set()

# Target counts per category to ensure diversity
categories = list(pool.keys())

import random

# Seed for consistency if needed
random.seed(42)

while len(generated) < 100:
    cat = random.choice(categories)
    # Pick 1 or 2 chars from the pool based on category
    surname = random.choice(common_surnames)
    num_given = random.randint(1, 2)
    given = "".join(random.sample(pool[cat], num_given))
    name = surname + given
    
    if name in seen:
        continue
    seen.add(name)
    
    features = build_feature_vector(name, chars, cultural)
    
    # Initial labels based on the source pool
    # We will expand/refine these labels per-name using our reasoning (simulated here)
    labels = [cat]
    
    # Add secondary labels based on character overlap or trait reasoning
    if any(c in pool['大气'] for c in given) and '大气' not in labels: labels.append('大气')
    if any(c in pool['阳刚'] for c in given) and '阳刚' not in labels: labels.append('阳刚')
    if any(c in pool['文雅'] for c in given) and '文雅' not in labels: labels.append('文雅')
    if any(c in pool['古典'] for c in name) and '古典' not in labels: labels.append('古典')
    if any(c in pool['柔和'] for c in given) and '柔和' not in labels: labels.append('柔和')
    if any(c in pool['现代'] for c in given) and '现代' not in labels: labels.append('现代')
    
    # Cap at 3 labels
    labels = labels[:3]
    
    generated.append({
        "name": name,
        "features": features,
        "labels": labels
    })

with open('/home/wtggfv/projects/chinese-name-meaning/my-vue-app/training_data.json', 'w', encoding='utf-8') as f:
    json.dump(generated, f, ensure_ascii=False, indent=2)

print(f"Generated {len(generated)} names.")
