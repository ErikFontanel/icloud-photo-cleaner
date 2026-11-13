"""Local models through Ollama on 127.0.0.1. A server is started only for the work and stopped again by its own PID."""

import base64
import contextlib
import io
import json
import subprocess
import time
import urllib.request
from urllib.error import HTTPError, URLError

from PIL import Image

URL = "http://127.0.0.1:11434"


def up() -> bool:
    try:
        urllib.request.urlopen(URL + "/api/version", timeout=1)
        return True
    except (URLError, OSError):
        return False


@contextlib.contextmanager
def serve():
    server = None if up() else subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            if up():
                break
            time.sleep(0.2)
        else:
            raise RuntimeError("Ollama did not start on 127.0.0.1:11434")
        yield
    finally:
        if server:
            server.terminate()
            server.wait(timeout=10)


def thumb(path: str, size: int = 512) -> str:
    """Base64 JPEG the model sees; it never leaves this machine."""
    im = Image.open(path).convert("RGB")
    im.thumbnail((size, size))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode()


def chat(model: str, prompt: str, schema: dict, images: list[str] = ()) -> dict:
    """JSON answer with the schema's required keys. Ollama 0.40 has no structured output for qwen3.5 (HTTP 501),
    so the schema goes in the prompt and the reply is parsed; one retry on a malformed reply."""
    content = f"{prompt}\n\nReply with only a JSON object matching this JSON schema:\n{json.dumps(schema)}"
    body = {
        "model": model,
        "stream": False,
        "think": False,
        "options": {"temperature": 0},
        "messages": [{"role": "user", "content": content, **({"images": list(images)} if images else {})}],
    }
    req = urllib.request.Request(URL + "/api/chat", json.dumps(body).encode(), {"Content-Type": "application/json"})
    for _attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                text = json.loads(r.read())["message"]["content"]
        except HTTPError as e:
            raise RuntimeError(f"Ollama {model}: HTTP {e.code}: {e.read().decode(errors='replace')[:300]}") from None
        try:
            answer = json.loads(text[text.index("{") : text.rindex("}") + 1])
            if all(k in answer for k in schema.get("required", [])):
                return answer
        except ValueError:
            pass
    raise RuntimeError(f"Ollama {model}: no valid JSON after 2 tries; last reply starts {text[:120]!r}")
