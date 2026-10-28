"""Копіює контракт зі Studio у grabfusion/contract_data.

Використання:  python scripts/sync_contract.py [шлях до Studio]   (без аргументу — корінь репозиторію: ../..)
Копіює docs/photo-drafts-api.md, docs/photo-drafts-api/schema.json і fixtures/*.json; друкує версію.
Після синхронізації запустіть `pytest`: тест покаже, якщо з'явилась фікстура, якої мок ще не віддає.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "grabfusion" / "contract_data"


def main(studio: str) -> int:
    docs = Path(studio) / "docs"
    src_md, src_dir = docs / "photo-drafts-api.md", docs / "photo-drafts-api"
    for p in (src_md, src_dir / "schema.json", src_dir / "fixtures"):
        if not p.exists():
            print(f"Немає {p}", file=sys.stderr)
            return 1
    shutil.copy2(src_md, DEST / "photo-drafts-api.md")
    shutil.copy2(src_dir / "schema.json", DEST / "schema.json")
    fx_dest = DEST / "fixtures"
    for old in fx_dest.glob("*.json"):
        old.unlink()
    for f in sorted((src_dir / "fixtures").glob("*.json")):
        shutil.copy2(f, fx_dest / f.name)
    sys.path.insert(0, str(ROOT))
    from grabfusion import contract
    contract.schema.cache_clear()
    print(f"Контракт {contract.contract_version()}, фікстур: {len(contract.fixture_names())}")
    return 0


if __name__ == "__main__":
    studio_root = sys.argv[1] if len(sys.argv) == 2 else str(ROOT.parent.parent)
    sys.exit(main(studio_root))
