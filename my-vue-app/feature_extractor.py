import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
CONTRACT_PATH = BASE_DIR / "src/model/feature-contract.v1.json"

with CONTRACT_PATH.open("r", encoding="utf-8") as contract_file:
    FEATURE_CONTRACT = json.load(contract_file)

FEATURE_SIZE = FEATURE_CONTRACT["size"]


def _contains_any(value, candidates):
    return any(candidate in value for candidate in candidates)


def _first_tone(value):
    return next((int(character) for character in str(value) if character.isdigit()), 0)


def build_feature_vector(chars):
    if FEATURE_SIZE != len(FEATURE_CONTRACT["features"]):
        raise ValueError("Feature contract size does not match its feature list.")

    scoped_chars = [char for char in chars if char.get("role") == "given"] \
        if FEATURE_CONTRACT["characterScope"] == "given" else chars
    counts = {
        "water": 0,
        "wood": 0,
        "fire": 0,
        "metal": 0,
        "earth": 0,
        "masculine": 0,
        "feminine": 0,
        "literary": 0,
        "natureRadical": 0,
        "humanRadical": 0,
        "abstractRadical": 0,
        "beauty": 0,
        "strength": 0,
        "virtue": 0,
        "nature": 0,
        "strongInitials": 0,
    }
    total_vowels = 0
    open_vowels = 0
    tone_changes = 0
    comparable_tone_pairs = 0
    last_tone = -1

    for char in scoped_chars:
        entry = char.get("entry") or {}
        cultural = char.get("cultural") or {}

        element_count = {
            "水": "water",
            "木": "wood",
            "火": "fire",
            "金": "metal",
            "土": "earth",
        }.get(cultural.get("element"))
        if element_count:
            counts[element_count] += 1

        gender = cultural.get("genderBias")
        if gender == "masculine":
            counts["masculine"] += 1
        if gender == "feminine":
            counts["feminine"] += 1
        if cultural.get("literaryRef"):
            counts["literary"] += 1

        radical = entry.get("radical") or cultural.get("localGloss", "")
        for category in ("nature", "human", "abstract"):
            if _contains_any(radical, FEATURE_CONTRACT["radicals"][category]):
                counts[f"{category}Radical"] += 1

        definition = entry.get("definition_cn", "")
        for category in ("beauty", "strength", "virtue", "nature"):
            if _contains_any(definition, FEATURE_CONTRACT["semantics"][category]):
                counts[category] += 1

        pinyin = "".join(
            FEATURE_CONTRACT["phonetics"]["toneVowelMap"].get(letter, letter)
            for letter in entry.get("pinyin", "").lower()
        )
        first_vowel_index = next(
            (index for index, letter in enumerate(pinyin) if letter in FEATURE_CONTRACT["phonetics"]["vowels"]),
            -1,
        )
        initials = pinyin if first_vowel_index == -1 else pinyin[:first_vowel_index]
        if _contains_any(initials, FEATURE_CONTRACT["phonetics"]["strongInitials"]):
            counts["strongInitials"] += 1

        for letter in pinyin:
            if letter not in FEATURE_CONTRACT["phonetics"]["vowels"]:
                continue
            total_vowels += 1
            if letter in FEATURE_CONTRACT["phonetics"]["openVowels"]:
                open_vowels += 1

        current_tone = _first_tone(entry.get("tones", "0"))
        if last_tone > 0 and current_tone > 0:
            comparable_tone_pairs += 1
            last_is_ping = last_tone in FEATURE_CONTRACT["phonetics"]["pingTones"]
            current_is_ping = current_tone in FEATURE_CONTRACT["phonetics"]["pingTones"]
            if last_is_ping != current_is_ping:
                tone_changes += 1
        last_tone = current_tone

    length = len(scoped_chars) or 1
    weights = FEATURE_CONTRACT["weights"]
    features = [0.0] * FEATURE_SIZE
    features[0] = length / weights["lengthDivisor"]
    features[1] = 0.0
    features[2] = (counts["masculine"] - counts["feminine"]) / length
    features[3] = sum(
        counts[element] > 0 for element in ("water", "wood", "fire", "metal", "earth")
    ) / weights["elementDiversityDivisor"]
    features[4] = counts["literary"] / length
    features[5] = counts["metal"] / length
    features[6] = counts["wood"] / length
    features[7] = counts["water"] / length
    features[8] = counts["fire"] / length
    features[9] = counts["earth"] / length
    features[10] = open_vowels / total_vowels if total_vowels else 0.0
    features[11] = tone_changes / comparable_tone_pairs if comparable_tone_pairs else 0.0
    features[12] = (counts["natureRadical"] / length) * weights["radical"] + (
        counts["nature"] / length
    ) * weights["semantic"]
    features[13] = (counts["humanRadical"] / length) * weights["radical"] + (
        counts["virtue"] / length
    ) * weights["semantic"]
    features[14] = (counts["abstractRadical"] / length) * weights["radical"] + (
        counts["strength"] / length
    ) * weights["semantic"]
    features[15] = (counts["strongInitials"] / length) * weights["strongInitial"] + (
        counts["beauty"] / length
    ) * weights["beauty"]

    return features
