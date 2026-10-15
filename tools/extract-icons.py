import base64
import re
import sys
import unicodedata
from pathlib import Path


def slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


if len(sys.argv) != 2:
    sys.exit(__doc__)

source = Path(sys.argv[1]).read_text(encoding="utf-8")
target = Path(__file__).resolve().parent.parent / "assets" / "icons"
target.mkdir(parents=True, exist_ok=True)

pattern = re.compile(r'\["([^"]+)","data:image/png;base64,([A-Za-z0-9+/=]+)"\]')
for name, payload in pattern.findall(source):
    (target / f"{slug(name)}.png").write_bytes(base64.b64decode(payload))
    print("guardado:", slug(name))
