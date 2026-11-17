"""Nagrywa frazy z glos/frazy.txt polskimi lektorkami z ElevenLabs.
Klucz API: sekret repozytorium ELEVENLABS_API_KEY. Wynik: glos/el_<nazwa>/<klucz>.mp3 + glos/lektorki.json"""
import json, os, re, sys, urllib.request, urllib.parse

KLUCZ = os.environ.get("ELEVENLABS_API_KEY", "").strip()
if not KLUCZ:
    sys.exit("Brak sekretu ELEVENLABS_API_KEY")
ILE = int(os.environ.get("ILE_LEKTOREK", "6"))
API = "https://api.elevenlabs.io"


def zapytanie(metoda, sciezka, dane=None, surowe=False):
    req = urllib.request.Request(API + sciezka, method=metoda,
                                 data=json.dumps(dane).encode() if dane is not None else None,
                                 headers={"xi-api-key": KLUCZ, "Content-Type": "application/json", "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=120) as r:
        b = r.read()
        return b if surowe else json.loads(b or b"{}")


# 1. polskie kobiece głosy z biblioteki ElevenLabs (natywne, najczęściej używane)
q = urllib.parse.urlencode({"language": "pl", "gender": "female", "page_size": 40, "sort": "usage_character_count_1y"})
glosy = zapytanie("GET", "/v1/shared-voices?" + q).get("voices", [])
wybrane, uzyte = [], set()
for g in glosy:
    nazwa = (g.get("name") or "").split(" - ")[0].strip()
    if not nazwa or nazwa.lower() in uzyte:
        continue
    wybrane.append(g); uzyte.add(nazwa.lower())
    if len(wybrane) >= ILE:
        break
print("Wybrane:", [(g["name"], g.get("accent"), g.get("age")) for g in wybrane])

# 2. dodaj do "Moich głosów" (wymagane do generowania); głosy już dodane pomijamy
moje = {v["voice_id"]: v for v in zapytanie("GET", "/v1/voices").get("voices", [])}
frazy = [l.strip().split("|", 1) for l in open("glos/frazy.txt", encoding="utf-8") if "|" in l]
lektorki = []
for g in wybrane:
    vid = g["voice_id"]
    if vid not in moje:
        try:
            zapytanie("POST", f"/v1/voices/add/{g['public_owner_id']}/{vid}", {"new_name": "KRAMM " + g["name"][:30]})
        except Exception as e:
            print("Nie dodano", g["name"], e); continue
    slug = "el_" + re.sub(r"[^a-z0-9]+", "_", g["name"].lower()).strip("_")[:24]
    os.makedirs(f"glos/{slug}", exist_ok=True)
    try:
        for klucz, tekst in frazy:
            audio = zapytanie("POST", f"/v1/text-to-speech/{vid}?output_format=mp3_44100_64", {
                "text": tekst, "model_id": "eleven_multilingual_v2", "language_code": "pl",
                "voice_settings": {"stability": 0.55, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True, "speed": 0.95}}, surowe=True)
            open(f"glos/{slug}/{klucz}.mp3", "wb").write(audio)
    except Exception as e:
        print("Błąd nagrania", g["name"], e); continue
    opis = ", ".join(x for x in [g.get("age", "").replace("_", " "), g.get("descriptive") or g.get("use_case")] if x)
    lektorki.append({"id": slug, "nazwa": g["name"].split(" - ")[0], "opis": opis})
    print("OK", g["name"])

json.dump(lektorki, open("glos/lektorki.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("Zapisano", len(lektorki), "lektorek")
if not lektorki:
    sys.exit(1)
