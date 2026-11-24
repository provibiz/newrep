from getpass import getpass
import json
from urllib.request import urlopen

token = getpass("Telegram-Bot-Token: ").strip()
try:
    with urlopen(f"https://api.telegram.org/bot{token}/getUpdates", timeout=20) as response:
        updates = json.load(response)["result"]
    chats = {c["id"]: c.get("first_name", "") for u in updates
             if (c := u.get("message", {}).get("chat", {})).get("type") == "private"}
    print(chats or "Keine neuen privaten Nachrichten. Bitte dem Bot /start schicken.")
except Exception:
    raise SystemExit("Abruf fehlgeschlagen. Token und Internetverbindung prüfen.")
