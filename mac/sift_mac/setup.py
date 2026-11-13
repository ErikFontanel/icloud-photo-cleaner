"""`sift-mac setup`: the only command that uses the network. Idempotent: skips what is already present."""

import shutil
import subprocess
import urllib.request
import zipfile

from . import config, llm

OLLAMA_MODELS = ["qwen3.5:2b", "qwen3.5:4b"]
HF_MODELS = ["mlx-community/embeddinggemma-2-8bit"]
GEONAMES = "https://download.geonames.org/export/dump/"
GEONAMES_FILES = ["cities1000.zip", "admin1CodesASCII.txt", "countryInfo.txt"]


def ollama() -> None:
    if not shutil.which("ollama"):
        print("Installing Ollama with Homebrew")
        subprocess.run(["brew", "install", "ollama"], check=True)
    with llm.serve():  # nothing stays running after the pulls
        for model in OLLAMA_MODELS:
            print(f"Pulling {model}")
            subprocess.run(["ollama", "pull", model], check=True)


def hf_models() -> None:
    from huggingface_hub import snapshot_download

    for repo in HF_MODELS:
        print(f"Downloading {repo}")
        snapshot_download(repo)


def geonames() -> None:
    target = config.geonames_dir()
    target.mkdir(parents=True, exist_ok=True)
    for name in GEONAMES_FILES:
        path = target / name
        if not path.exists():
            print(f"Downloading GeoNames {name}")
            urllib.request.urlretrieve(GEONAMES + name, path)
    if not (target / "cities1000.txt").exists():
        with zipfile.ZipFile(target / "cities1000.zip") as z:
            z.extract("cities1000.txt", target)


def run() -> None:
    geonames()
    hf_models()
    ollama()
    print("Setup done. All other commands run offline.")
