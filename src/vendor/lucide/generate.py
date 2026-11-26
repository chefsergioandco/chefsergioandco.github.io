"""Vendor a fixed official Lucide subset; rendering has no network or package dependency.

Run with --download to refresh the pinned source SVGs and license, or without it
to regenerate nodes.ts from the already-vendored SVGs entirely offline.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
import json
from pathlib import Path
import re
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
REPOSITORY = "lucide-icons/lucide"
RELEASE = "0.468.0"
NAMES = [
    "utensils-crossed", "chef-hat", "party-popper", "armchair", "book-open", "gift",
    "arrow-up-right", "arrow-right", "phone", "mail", "map-pin", "instagram", "facebook",
    "menu", "x", "chevron-down", "check", "home", "image", "users", "calendar-days", "clock",
    "circle-check", "external-link", "camera", "heart-handshake",
    "plus", "chevron-left", "chevron-right", "arrow-left", "arrow-up", "pause", "play",
]
ALIASES = {"home": "house"}
TAGS = {"path", "circle", "line", "polyline", "polygon", "rect", "ellipse"}
ATTRIBUTES = {
    "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
    "width", "height", "points", "fill", "stroke", "stroke-width", "stroke-linecap",
    "stroke-linejoin", "fill-rule", "clip-rule", "opacity",
}
REACT_NAMES = {
    "stroke-width": "strokeWidth", "stroke-linecap": "strokeLinecap",
    "stroke-linejoin": "strokeLinejoin", "fill-rule": "fillRule", "clip-rule": "clipRule",
}


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Chef-Sergio-vendored-icons/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def download() -> dict:
    commit_info = json.loads(fetch(f"https://api.github.com/repos/{REPOSITORY}/commits/{RELEASE}"))
    commit = commit_info["sha"]
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Invalid upstream commit identifier")
    base = f"https://raw.githubusercontent.com/{REPOSITORY}/{commit}"
    source_dir = ROOT / "sources"
    source_dir.mkdir(parents=True, exist_ok=True)

    def get_icon(name: str) -> tuple[str, dict]:
        source_name = ALIASES.get(name, name)
        url = f"{base}/icons/{source_name}.svg"
        source = fetch(url)
        (source_dir / f"{name}.svg").write_bytes(source)
        return name, {"upstream_name": source_name, "source": url, "sha256": sha256(source).hexdigest()}

    with ThreadPoolExecutor(max_workers=4) as executor:
        icons = dict(executor.map(get_icon, NAMES))
    license_bytes = fetch(f"{base}/LICENSE")
    (ROOT / "LICENSE").write_bytes(license_bytes)
    provenance = {
        "project": "Lucide", "repository": f"https://github.com/{REPOSITORY}",
        "release": RELEASE, "commit": commit,
        "license_source": f"{base}/LICENSE", "license_sha256": sha256(license_bytes).hexdigest(),
        "rendering": "Original SVG primitives; wrapper uses currentColor and a default 1.75px stroke.",
        "aliases": ALIASES, "icons": icons,
    }
    (ROOT / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    return provenance


def generate(provenance: dict) -> None:
    result = {}
    for name in NAMES:
        raw = (ROOT / "sources" / f"{name}.svg").read_bytes()
        if sha256(raw).hexdigest() != provenance["icons"][name]["sha256"]:
            raise ValueError(f"{name}: source differs from the pinned upstream copy")
        svg = ET.fromstring(raw)
        if svg.tag.rsplit("}", 1)[-1] != "svg" or svg.attrib.get("viewBox") != "0 0 24 24":
            raise ValueError(f"{name}: unexpected SVG canvas")
        nodes = []
        for child in svg:
            tag = child.tag.rsplit("}", 1)[-1]
            if tag not in TAGS or len(child) or not set(child.attrib).issubset(ATTRIBUTES):
                raise ValueError(f"{name}: unexpected SVG element or attribute")
            nodes.append([tag, {REACT_NAMES.get(key, key): value for key, value in child.attrib.items()}])
        if not nodes:
            raise ValueError(f"{name}: empty icon")
        result[name] = nodes
    union = " | ".join(json.dumps(name) for name in NAMES)
    content = (
        "// Generated from the vendored official Lucide SVGs. See LICENSE and provenance.json.\n"
        "// Regenerate offline with: python3 src/vendor/lucide/generate.py\n"
        f"export type IconName = {union}\n"
        "type IconNode = readonly [tag: string, attributes: Readonly<Record<string, string>>]\n"
        "export const iconNodes: Record<IconName, readonly IconNode[]> = "
        + json.dumps(result, indent=2) + "\n"
    )
    (ROOT / "nodes.ts").write_text(content)
    print(json.dumps({"icons": len(result), "release": provenance["release"], "commit": provenance["commit"], "nodes_bytes": len(content.encode())}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="Refresh the pinned official source files")
    args = parser.parse_args()
    metadata = download() if args.download else json.loads((ROOT / "provenance.json").read_text())
    generate(metadata)
