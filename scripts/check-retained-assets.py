#!/usr/bin/env python3
"""Exercise retained Pages assets using real ZIP/TAR protocol fixtures.

Run from any directory with ``python3 scripts/check-retained-assets.py``.
These checks use only temporary local files and the Python standard library.
"""

from __future__ import annotations

import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
import zipfile


HELPER_PATH = Path(__file__).with_name("retain-staging-assets.py")
SPEC = importlib.util.spec_from_file_location("retain_staging_assets", HELPER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot load retention helper: {HELPER_PATH}")
HELPER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HELPER
sys.dont_write_bytecode = True
SPEC.loader.exec_module(HELPER)

CURRENT_JS = "assets/index-c1111111.js"
CURRENT_CSS = "assets/index-c1111111.css"
OLD_JS = "assets/AccountPage-a1111111.js"
OLD_CSS = "assets/AccountPage-a1111111.css"
OLD_FONT = "assets/salon-a1111111.woff2"
OLD_CHUNK = "assets/shared-a2222222.js"


def manifest_bytes(manifest: object) -> bytes:
    return json.dumps(manifest, separators=(",", ":"), sort_keys=True).encode()


class RetainedAssetsChecks(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="chef-retained-assets-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.dist = self.root / "dist"
        self.dist.mkdir()
        self.write_current(
            {
                "index.html": {
                    "file": CURRENT_JS,
                    "isEntry": True,
                    "css": [CURRENT_CSS],
                }
            }
        )
        self.write_dist(CURRENT_JS, b"current javascript\n")
        self.write_dist(CURRENT_CSS, b"current stylesheet\n")
        self.write_dist("index.html", b"<!doctype html><title>Current page</title>")
        self.archive_number = 0

    def write_dist(self, relative: str, data: bytes) -> Path:
        target = self.dist / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return target

    def write_current(self, manifest: object) -> None:
        self.write_dist(".vite/manifest.json", manifest_bytes(manifest))

    def archive(
        self,
        manifest: object | None,
        files: dict[str, bytes] | None = None,
        *,
        manifest_raw: bytes | None = None,
        links: dict[str, str] | None = None,
        hardlinks: dict[str, str] | None = None,
        extra_members: dict[str, bytes] | None = None,
    ) -> Path:
        """Create the same ZIP -> artifact.tar nesting used by Pages artifacts."""
        members = {
            f"./{name}": data for name, data in (files or {}).items()
        }
        if manifest_raw is not None:
            members["./.vite/manifest.json"] = manifest_raw
        elif manifest is not None:
            members["./.vite/manifest.json"] = manifest_bytes(manifest)
        members.update(extra_members or {})
        tar_data = io.BytesIO()
        with tarfile.open(fileobj=tar_data, mode="w") as artifact:
            for name, data in members.items():
                member = tarfile.TarInfo(name)
                member.size = len(data)
                member.mode = 0o644
                artifact.addfile(member, io.BytesIO(data))
            for kind, entries in (
                (tarfile.SYMTYPE, links or {}),
                (tarfile.LNKTYPE, hardlinks or {}),
            ):
                for name, target in entries.items():
                    member = tarfile.TarInfo(f"./{name}")
                    member.type = kind
                    member.linkname = target
                    artifact.addfile(member)
        return self.zip_bytes(tar_data.getvalue())

    def zip_bytes(self, tar_data: bytes, *, member: str = "artifact.tar") -> Path:
        self.archive_number += 1
        target = self.root / f"pages-{self.archive_number}.zip"
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as artifact:
            artifact.writestr(member, tar_data)
        return target

    def snapshot(self) -> dict[str, tuple[str, bytes | str]]:
        snapshot = {}
        for path in self.dist.rglob("*"):
            relative = path.relative_to(self.dist).as_posix()
            if path.is_symlink():
                snapshot[relative] = ("symlink", str(path.readlink()))
            elif path.is_file():
                snapshot[relative] = ("file", path.read_bytes())
            elif path.is_dir():
                snapshot[relative] = ("directory", "")
        return snapshot

    def assert_rejected_without_writes(self, archives: list[Path]) -> None:
        before = self.snapshot()
        with self.assertRaises(Exception):
            HELPER.retain_assets(self.dist, archives)
        self.assertEqual(before, self.snapshot(), "Rejected input changed the build")

    def test_keeps_current_bytes_and_copies_prior_manifest_page_dependencies(self) -> None:
        current = self.snapshot()
        retained = {
            OLD_JS: b"old lazy account javascript\n",
            OLD_CSS: b"old lazy account stylesheet\n",
            OLD_FONT: b"old woff2 bytes",
            "assets/salon-a3333333.woff": b"old woff bytes",
            "assets/salon-a4444444.ttf": b"old truetype bytes",
            OLD_CHUNK: b"old shared javascript\n",
        }
        archive = self.archive(
            {
                "src/AccountPage.tsx": {
                    "file": OLD_JS,
                    "css": [OLD_CSS],
                    "assets": [OLD_FONT, "assets/salon-a3333333.woff", "assets/salon-a4444444.ttf"],
                    "imports": ["_shared.js"],
                },
                "_shared.js": {"file": OLD_CHUNK},
            },
            retained,
        )
        summary = HELPER.retain_assets(self.dist, [archive])
        self.assertIsInstance(summary, dict)
        for path, contents in retained.items():
            with self.subTest(path=path):
                self.assertEqual(contents, (self.dist / path).read_bytes())
        after = self.snapshot()
        for path, state in current.items():
            with self.subTest(current=path):
                self.assertEqual(state, after[path])
        self.assertEqual(set(current) | set(retained), set(after))

    def test_only_own_manifest_prevents_recursive_retention_growth(self) -> None:
        ancient = "assets/retained-from-four-builds-ago-deadbeef.js"
        archive = self.archive(
            {"src/page.ts": {"file": OLD_JS}},
            {OLD_JS: b"previous build", ancient: b"previously retained but unreferenced"},
        )
        HELPER.retain_assets(self.dist, [archive])
        self.assertTrue((self.dist / OLD_JS).is_file())
        self.assertFalse((self.dist / ancient).exists())

    def test_ignores_html_private_files_unhashed_and_unsupported_assets(self) -> None:
        ignored = {
            "index.html": b"OLD HTML MUST NOT REPLACE THE CURRENT PAGE",
            "private/credentials.json": b'{"token":"fixture-secret"}',
            ".env": b"SECRET=fixture-secret",
            "assets/unhashed.js": b"unhashed javascript",
            "assets/photo-a1111111.png": b"fixture image",
            "assets/nested/module-a1111111.js": b"nested javascript",
            "assets/index-a1111111.js.map": b"source map",
        }
        before = self.snapshot()
        archive = self.archive(
            {
                "index.html": {
                    "file": OLD_JS,
                    "assets": ["assets/photo-a1111111.png"],
                }
            },
            {OLD_JS: b"allowed page module", **ignored},
            extra_members={"../../outside-unreferenced.txt": b"never extract this"},
        )
        HELPER.retain_assets(self.dist, [archive])
        self.assertEqual(before["index.html"], self.snapshot()["index.html"])
        self.assertEqual(set(before) | {OLD_JS}, set(self.snapshot()))
        self.assertFalse((self.root / "outside-unreferenced.txt").exists())

    def test_accepts_three_prior_builds(self) -> None:
        archives = []
        for age in range(3):
            name = f"assets/page-{age}abc1234.js"
            archives.append(self.archive({"page": {"file": name}}, {name: str(age).encode()}))
        HELPER.retain_assets(self.dist, archives)
        for age in range(3):
            self.assertEqual(str(age).encode(), (self.dist / f"assets/page-{age}abc1234.js").read_bytes())

    def test_rejects_more_than_three_archives_before_writes(self) -> None:
        archive = self.archive({"page": {"file": OLD_JS}}, {OLD_JS: b"old page"})
        self.assert_rejected_without_writes([archive] * 4)

    def test_identical_existing_hash_bytes_are_preserved(self) -> None:
        current_bytes = (self.dist / CURRENT_JS).read_bytes()
        before = self.snapshot()
        archive = self.archive({"page": {"file": CURRENT_JS}}, {CURRENT_JS: current_bytes})
        HELPER.retain_assets(self.dist, [archive])
        self.assertEqual(before, self.snapshot())

    def test_rejects_existing_hash_with_different_bytes(self) -> None:
        archive = self.archive({"page": {"file": CURRENT_JS}}, {CURRENT_JS: b"different bytes"})
        self.assert_rejected_without_writes([archive])

    def test_rejects_hash_collision_across_archives_before_writes(self) -> None:
        newest = self.archive({"page": {"file": OLD_JS}}, {OLD_JS: b"newest bytes"})
        older = self.archive({"page": {"file": OLD_JS}}, {OLD_JS: b"older conflicting bytes"})
        self.assert_rejected_without_writes([newest, older])

    def test_rejects_referenced_symlink_before_writes(self) -> None:
        symlink = "assets/link-a1111111.js"
        archive = self.archive(
            {"page": {"file": OLD_JS, "assets": [symlink]}},
            {OLD_JS: b"must not be copied before symlink validation"},
            links={symlink: "../../private/credential.js"},
        )
        self.assert_rejected_without_writes([archive])

    def test_rejects_referenced_hardlink_before_writes(self) -> None:
        hardlink = "assets/link-a1111111.js"
        archive = self.archive(
            {"page": {"file": OLD_JS, "assets": [hardlink]}},
            {OLD_JS: b"must not be copied before hardlink validation"},
            hardlinks={hardlink: f"./{OLD_JS}"},
        )
        self.assert_rejected_without_writes([archive])

    def test_rejects_referenced_path_traversal_before_writes(self) -> None:
        traversal = "assets/../../escape-a1111111.js"
        archive = self.archive(
            {"page": {"file": OLD_JS, "assets": [traversal]}},
            {OLD_JS: b"must not be copied before path validation", traversal: b"escape bytes"},
        )
        self.assert_rejected_without_writes([archive])
        self.assertFalse((self.root / "escape-a1111111.js").exists())

    def test_invalid_later_archive_does_not_partially_copy_valid_first_archive(self) -> None:
        good = self.archive({"page": {"file": OLD_JS}}, {OLD_JS: b"must remain uncopied"})
        bad = self.archive(None)
        self.assert_rejected_without_writes([good, bad])

    def test_rejects_missing_referenced_asset(self) -> None:
        archive = self.archive({"page": {"file": OLD_JS}})
        self.assert_rejected_without_writes([archive])

    def test_rejects_missing_prior_manifest(self) -> None:
        archive = self.archive(None, {OLD_JS: b"unverifiable prior build"})
        self.assert_rejected_without_writes([archive])

    def test_rejects_missing_current_manifest(self) -> None:
        (self.dist / ".vite/manifest.json").unlink()
        archive = self.archive({"page": {"file": OLD_JS}}, {OLD_JS: b"old page"})
        self.assert_rejected_without_writes([archive])

    def test_rejects_damaged_json_manifest(self) -> None:
        archive = self.archive(None, manifest_raw=b'{"page":')
        self.assert_rejected_without_writes([archive])

    def test_rejects_manifest_with_wrong_top_level_shape(self) -> None:
        archive = self.archive([{"file": OLD_JS}], {OLD_JS: b"old page"})
        self.assert_rejected_without_writes([archive])

    def test_rejects_oversized_manifest(self) -> None:
        limit = getattr(HELPER, "MAX_MANIFEST_BYTES", 2 * 1024 * 1024)
        oversized = manifest_bytes({"page": {"file": OLD_JS, "padding": "x" * (limit + 1)}})
        archive = self.archive(None, {OLD_JS: b"old page"}, manifest_raw=oversized)
        self.assert_rejected_without_writes([archive])

    def test_rejects_missing_archive(self) -> None:
        self.assert_rejected_without_writes([self.root / "missing.zip"])

    def test_rejects_damaged_zip(self) -> None:
        damaged = self.root / "damaged.zip"
        damaged.write_bytes(b"not a ZIP archive")
        self.assert_rejected_without_writes([damaged])

    def test_rejects_oversized_zip(self) -> None:
        limit = getattr(HELPER, "MAX_ARCHIVE_BYTES", 128 * 1024 * 1024)
        valid = self.archive({"page": {"file": OLD_JS}}, {OLD_JS: b"old page"})
        with zipfile.ZipFile(valid) as archive:
            tar_data = archive.read("artifact.tar")
        oversized = self.root / "oversized.zip"
        # ZIP permits a prefix. Sparse padding makes this a valid oversized ZIP
        # without writing hundreds of megabytes merely to exercise its bound.
        with oversized.open("wb") as archive:
            archive.truncate(limit + 1)
        with zipfile.ZipFile(oversized, "a", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("artifact.tar", tar_data)
        with zipfile.ZipFile(oversized) as archive:
            self.assertEqual(tar_data, archive.read("artifact.tar"))
        self.assert_rejected_without_writes([oversized])

    def test_rejects_zip_without_artifact_tar(self) -> None:
        archive = self.zip_bytes(b"unrelated data", member="different.tar")
        self.assert_rejected_without_writes([archive])

    def test_rejects_damaged_tar(self) -> None:
        archive = self.zip_bytes(b"not a TAR archive")
        self.assert_rejected_without_writes([archive])


if __name__ == "__main__":
    unittest.main(verbosity=2)
