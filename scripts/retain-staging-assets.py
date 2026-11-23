"""Read trusted Pages archives without extracting paths; keep only manifest assets."""
import hashlib
import io
import json
import re
import sys
import tarfile
import zipfile
from pathlib import Path

MAX_ARCHIVES = 3
MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_RETAINED_BYTES = 64 * 1024 * 1024
ASSET = re.compile(r"assets/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf)\Z")


def manifest_assets(data):
    if not isinstance(data, dict) or len(data) > 2048:
        raise ValueError("Invalid Vite manifest")
    result = set()
    for item in data.values():
        if not isinstance(item, dict):
            raise ValueError("Invalid Vite manifest entry")
        values = [item.get("file")] + item.get("css", []) + item.get("assets", [])
        for name in values:
            if not isinstance(name, str):
                raise ValueError("Invalid manifest asset name")
            # Other build outputs (e.g. public images) are outside this retention scope.
            if not name.endswith((".js", ".css", ".woff", ".woff2", ".ttf")):
                continue
            if not ASSET.fullmatch(name):
                raise ValueError("Manifest assets must be flat hashed build files")
            result.add(name)
    if not result or len(result) > 1024:
        raise ValueError("Invalid manifest asset count")
    return result


def archive_assets(path):
    if path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("Pages ZIP exceeds the archive limit")
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) != 1 or entries[0].filename != "artifact.tar" or entries[0].file_size > MAX_ARCHIVE_BYTES:
            raise ValueError("Expected one bounded Pages artifact.tar")
        contents = archive.read(entries[0])  # zipfile also checks the entry CRC.
    with tarfile.open(fileobj=io.BytesIO(contents), mode="r:") as archive:
        members = archive.getmembers()
        if len(members) > 10000:
            raise ValueError("Pages TAR contains too many entries")
        indexed = {}
        for member in members:
            name = member.name[2:] if member.name.startswith("./") else member.name
            if name in indexed:
                raise ValueError("Duplicate Pages TAR entry")
            indexed[name] = member
        manifest = indexed.get(".vite/manifest.json")
        if not manifest or not manifest.isfile() or manifest.size > MAX_MANIFEST_BYTES:
            raise ValueError("Missing or invalid original Vite manifest")
        names = manifest_assets(json.loads(archive.extractfile(manifest).read(MAX_MANIFEST_BYTES + 1)))
        result = {}
        for name in names:
            member = indexed.get(name)
            if not member or not member.isfile() or member.size > MAX_FILE_BYTES:
                raise ValueError("Manifest asset missing, oversized or not a regular file")
            value = archive.extractfile(member).read(MAX_FILE_BYTES + 1)
            if len(value) != member.size:
                raise ValueError("Truncated Pages asset")
            result[name] = value
        return result


def retain_assets(dist, archives):
    dist = Path(dist)
    if len(archives) > MAX_ARCHIVES:
        raise ValueError("At most three previous builds may be retained")
    assets = dist / "assets"
    manifest = dist / ".vite/manifest.json"
    if not assets.is_dir() or assets.is_symlink() or not manifest.is_file() or manifest.is_symlink() or manifest.stat().st_size > MAX_MANIFEST_BYTES:
        raise ValueError("Invalid current build")
    current = manifest_assets(json.loads(manifest.read_text()))
    for name in current:
        path = dist / name
        if not path.is_file() or path.is_symlink() or path.stat().st_size > MAX_FILE_BYTES:
            raise ValueError("Invalid current build asset")
    selected = {}
    for archive in archives:
        for name, value in archive_assets(Path(archive)).items():
            if name in selected and selected[name] != value:
                raise ValueError("Conflicting hash-named assets in prior builds")
            selected.setdefault(name, value)
    if len(selected) > 1024 or sum(map(len, selected.values())) > MAX_RETAINED_BYTES:
        raise ValueError("Retained assets exceed the publication bound")
    # Complete every validation before touching the new build. Existing files win.
    pending = {}
    for name, value in selected.items():
        destination = dist / name
        if destination.exists() or destination.is_symlink():
            if not destination.is_file() or destination.is_symlink() or hashlib.sha256(destination.read_bytes()).digest() != hashlib.sha256(value).digest():
                raise ValueError("Conflicting existing hash-named asset")
        else:
            pending[name] = value
    for name, value in pending.items():
        with (dist / name).open("xb") as output:
            output.write(value)
    return {"currentAssets": len(current), "retainedAssets": len(pending), "retainedBytes": sum(map(len, pending.values())), "generations": len(archives)}


if __name__ == "__main__":
    try:
        print(json.dumps(retain_assets(Path(sys.argv[1]), [Path(path) for path in sys.argv[2:]])))
    except Exception as error:
        print("Asset retention failed: " + str(error), file=sys.stderr)
        sys.exit(1)
