"""plant_atlas SQLite -> 현장 빠른입력기용 종 사전(JSON) 추출.

원본 DB는 읽기 전용으로만 연다. 출력: web/data/taxa.json
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import unicodedata

DEFAULT_DB = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "plant_atlas", "_backup", "atlas.sqlite3.before_dedup_20260915_164813",
)


def norm(s: str) -> str:
    """검색 키 정규화: NFC, 소문자, 공백/점/괄호 제거."""
    if not s:
        return ""
    s = unicodedata.normalize("NFC", s).lower()
    return "".join(ch for ch in s if ch.isalnum())


def sci_short(scientific: str) -> str:
    """'Huperzia asiatica (Ching) N.Shrestha' -> 'Huperzia asiatica' (속+종소명)."""
    if not scientific:
        return ""
    parts = scientific.split()
    out = []
    for p in parts:
        if out and (p[0].isupper() or p.startswith("(")):
            break
        out.append(p)
        if len(out) == 2:
            break
    return " ".join(out[:2])


def load_taxa(db_path: str) -> list[dict]:
    if not os.path.exists(db_path):
        raise SystemExit(f"DB 없음: {db_path}")
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT id, name, scientific, genus, genus_ko, family, aliases FROM taxa"
    ).fetchall()
    out = []
    for r in rows:
        name = (r["name"] or "").strip()
        if not name:
            continue
        try:
            aliases = json.loads(r["aliases"] or "[]")
        except Exception:
            aliases = []
        aliases = [a.strip() for a in aliases if a and a.strip() and a.strip() != name]
        out.append(
            {
                "i": r["id"],
                "n": name,
                "s": sci_short(r["scientific"] or ""),
                "f": (r["family"] or "").strip(),
                "a": sorted(set(aliases)),
            }
        )
    con.close()
    out.sort(key=lambda t: t["n"])
    return out


def build_index(taxa: list[dict]) -> dict[str, list[int]]:
    """정규화 키 -> taxon id 목록."""
    idx: dict[str, list[int]] = {}
    for t in taxa:
        keys = {norm(t["n"])}
        if t["s"]:
            keys.add(norm(t["s"]))
        for a in t["a"]:
            keys.add(norm(a))
        for k in keys:
            if k:
                idx.setdefault(k, []).append(t["i"])
    return idx


def main() -> int:
    db = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DB
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_path = os.path.join(root, "web", "data", "taxa.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    taxa = load_taxa(db)
    idx = build_index(taxa)
    payload = {"version": 1, "source": os.path.basename(db), "taxa": taxa}
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(out_path)
    print(f"taxa={len(taxa)} keys={len(idx)} -> {out_path} ({size/1024/1024:.2f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
