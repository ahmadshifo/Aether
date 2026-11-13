"""Run locally to enter keys without echoing them or adding them to shell history."""
import argparse
from getpass import getpass
from pathlib import Path
from dotenv import set_key
from app.config import Settings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Only report setup status; no API calls")
    args = parser.parse_args()
    target = Path(__file__).resolve().parent / ".env"
    if not args.check:
        print("Use Groq Free and a Gemini project WITHOUT billing. Never paste keys into chat or Git.")
        print("Groq: https://console.groq.com/keys")
        print("Gemini: https://aistudio.google.com/apikey")
        for name in ("GROQ_API_KEY", "GEMINI_API_KEY"):
            value = getpass(f"{name} (hidden; Enter keeps existing value): ").strip()
            if value:
                if not value.isascii() or any(c.isspace() for c in value):
                    raise SystemExit("Invalid key characters; nothing was printed.")
                set_key(str(target), name, value, quote_mode="always")
        print(f"Saved privately in {target}. Restart the voice service.")
    config = Settings.load()
    print(f"Groq key present: {bool(config.groq_key)}; Gemini key present: {bool(config.gemini_key)}; FFmpeg: {config.audio_ready}")
    print("This checks configuration only, not provider access or free-plan eligibility.")


if __name__ == "__main__":
    main()
