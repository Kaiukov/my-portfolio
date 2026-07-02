"""
Create a single Tally form for all 5 real estate properties in Izmail.
One form, one submission, all objects at once.
"""

import json, subprocess, uuid

TOKEN_FILE = "/root/.hermes/profiles/financial/.env"

def load_token():
    with open(TOKEN_FILE) as f:
        for line in f:
            if line.startswith("TALLY_API_TOKEN="):
                return line.strip().split("=", 1)[1]
    raise RuntimeError("TALLY_API_TOKEN not found in .env")

def uid():
    return str(uuid.uuid4())

def safe_html(text):
    return [[text]]

def build_form(form_name, blocks_data, language="ru"):
    """blocks_data: list of block dicts"""
    blocks = []

    # FORM_TITLE
    blocks.append({
        "uuid": uid(), "groupUuid": uid(),
        "groupType": "FORM_TITLE", "type": "FORM_TITLE",
        "payload": {"title": form_name, "safeHTMLSchema": safe_html(form_name)}
    })

    for b in blocks_data:
        blocks.append(b)

    form = {
        "name": form_name, "status": "PUBLISHED",
        "blocks": blocks,
        "settings": {"language": language, "isClosed": False}
    }

    token = load_token()
    result = subprocess.run([
        "curl", "-s", "-X", "POST", "https://api.tally.so/forms",
        "-H", f"Authorization: Bearer {token}",
        "-H", "Content-Type: application/json",
        "-d", json.dumps(form, ensure_ascii=False)
    ], capture_output=True, text=True, timeout=30)

    resp = json.loads(result.stdout)
    if "id" in resp:
        form_id = resp["id"]
        print(f"✅ Form created: https://tally.so/r/{form_id}")
        return form_id
    else:
        print(f"❌ Error: {resp}")
        return resp


def text_block(text):
    """Informational text block for section headers."""
    return {
        "uuid": uid(), "groupUuid": uid(),
        "groupType": "TEXT", "type": "TEXT",
        "payload": {"safeHTMLSchema": safe_html(text)}
    }

def divider():
    return {
        "uuid": uid(), "groupUuid": uid(),
        "groupType": "DIVIDER", "type": "DIVIDER",
        "payload": {}
    }

def question_input(text, placeholder="", required=True):
    """Returns two blocks: TITLE + INPUT_TEXT"""
    q_text = text + (" *" if required else "")
    title = {
        "uuid": uid(), "groupUuid": uid(),
        "groupType": "QUESTION", "type": "TITLE",
        "payload": {"safeHTMLSchema": safe_html(q_text)}
    }
    payload = {"isRequired": required}
    if placeholder:
        payload["placeholder"] = placeholder
    inp = {
        "uuid": uid(), "groupUuid": uid(),
        "groupType": "INPUT_TEXT", "type": "INPUT_TEXT",
        "payload": payload
    }
    return [title, inp]


blocks = []

# === SECTION 1: 2-комнатная квартира ===
blocks.append(text_block("🏠 **Объект 1: 2-комнатная квартира**"))
blocks += question_input("Описание 2-комнатной квартиры",
                         placeholder="например: ул. Центральная, 5й этаж, кирпичный дом, ремонт")
blocks += question_input("Площадь 2-комнатной квартиры (м²)",
                         placeholder="например: 52")
blocks += question_input("Стоимость 2-комнатной квартиры (USD)",
                         placeholder="например: 35000")
blocks.append(divider())

# === SECTION 2: 1-комнатная квартира #1 ===
blocks.append(text_block("🏠 **Объект 2: 1-комнатная квартира №1**"))
blocks += question_input("Описание 1-комнатной квартиры №1",
                         placeholder="например: ул. Дунайская, 3й этаж")
blocks += question_input("Площадь 1-комнатной квартиры №1 (м²)",
                         placeholder="например: 32")
blocks += question_input("Стоимость 1-комнатной квартиры №1 (USD)",
                         placeholder="например: 22000")
blocks.append(divider())

# === SECTION 3: 1-комнатная квартира #2 ===
blocks.append(text_block("🏠 **Объект 3: 1-комнатная квартира №2**"))
blocks += question_input("Описание 1-комнатной квартиры №2",
                         placeholder="например: ул. Дунайская, 5й этаж")
blocks += question_input("Площадь 1-комнатной квартиры №2 (м²)",
                         placeholder="например: 30")
blocks += question_input("Стоимость 1-комнатной квартиры №2 (USD)",
                         placeholder="например: 20000")
blocks.append(divider())

# === SECTION 4: Стоянки ===
blocks.append(text_block("🚗 **Объект 4: Стоянки (2 места)**"))
blocks += question_input("Общая стоимость двух стоянок (USD)",
                         placeholder="например: 5000")
blocks.append(divider())

# === SECTION 5: Кладовка ===
blocks.append(text_block("📦 **Объект 5: Кладовка**"))
blocks += question_input("Площадь кладовки (м²)",
                         placeholder="например: 12")
blocks += question_input("Стоимость кладовки (USD)",
                         placeholder="например: 3000")


form_id = build_form(
    "🏠 Недвижимость — Измаил (все объекты)",
    blocks
)
