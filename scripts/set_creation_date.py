#!/usr/bin/env python3
"""
Set creation/modification/access timestamps on every file & folder under a
root directory to a chosen date.

Usage:
    python scripts/set_creation_date.py                 # defaults: . and 2026-05-09
    python scripts/set_creation_date.py --root /path    # custom root
    python scripts/set_creation_date.py --date 2026-05-09
    python scripts/set_creation_date.py --dry-run       # just report counts
    python scripts/set_creation_date.py --include-deps  # also touch node_modules / .venv
    python scripts/set_creation_date.py --include-vcs   # also touch .git

What it sets:
    - mtime + atime via os.utime(...)             — works on every OS.
    - birthtime via `SetFile -d "MM/DD/YYYY hh:mm:ss"` (macOS only).
      Requires Xcode Command Line Tools (`xcode-select --install`).
      Skipped silently if SetFile is unavailable.

Default skip list (override with the flags above):
    .git, .hg, .svn, .DS_Store
    node_modules, .venv*, venv, env, __pycache__, .pytest_cache, .mypy_cache
    dist, build, .next, .vercel, .nuxt, .turbo, .cache, .parcel-cache
    .claude/worktrees                                  # local agent scratch dirs
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


VCS_DIRS = {".git", ".hg", ".svn"}
DEPS_DIRS = {
    "node_modules",
    ".venv",
    ".venv-openai-test",
    "venv",
    "env",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    "dist",
    "build",
    ".next",
    ".vercel",
    ".nuxt",
    ".turbo",
    ".cache",
    ".parcel-cache",
}
ALWAYS_SKIP = {".DS_Store"}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--root", default=".", help="Directory to walk. Default: current directory.")
    p.add_argument("--date", default="2026-05-09", help="Target date YYYY-MM-DD. Default: 2026-05-09.")
    p.add_argument("--time", default="12:00:00", help="Target time HH:MM:SS local. Default: 12:00:00.")
    p.add_argument("--dry-run", action="store_true", help="Don't modify anything, just count.")
    p.add_argument("--include-vcs", action="store_true", help="Don't skip .git / .hg / .svn.")
    p.add_argument("--include-deps", action="store_true", help="Don't skip node_modules / .venv / build / etc.")
    p.add_argument(
        "--no-birthtime", action="store_true",
        help="Skip the macOS SetFile birthtime step (only adjust mtime / atime).",
    )
    p.add_argument(
        "--quiet", action="store_true",
        help="Don't print every file. Only summary at end.",
    )
    return p.parse_args()


def build_skip(args: argparse.Namespace) -> set[str]:
    skip: set[str] = set(ALWAYS_SKIP)
    if not args.include_vcs:
        skip |= VCS_DIRS
    if not args.include_deps:
        skip |= DEPS_DIRS
    return skip


def find_setfile() -> str | None:
    """SetFile lives at /usr/bin/SetFile on macOS when Xcode CLT is installed."""
    if sys.platform != "darwin":
        return None
    return shutil.which("SetFile")


def to_epoch(date_str: str, time_str: str) -> float:
    return time.mktime(datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M:%S").timetuple())


def set_birthtime_macos(setfile_bin: str, path: Path, date_str: str, time_str: str) -> None:
    """SetFile -d 'MM/DD/YYYY HH:MM:SS' <path>"""
    y, m, d = date_str.split("-")
    fmt = f"{m}/{d}/{y} {time_str}"
    # SetFile fails on symlinks / sockets; ignore stderr noise.
    subprocess.run(
        [setfile_bin, "-d", fmt, str(path)],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    if not root.exists():
        print(f"ERROR: {root} does not exist", file=sys.stderr)
        return 1

    skip = build_skip(args)
    epoch = to_epoch(args.date, args.time)
    setfile = None if args.no_birthtime else find_setfile()
    if not args.no_birthtime and setfile is None and sys.platform == "darwin":
        print("WARN: `SetFile` not found — skipping birthtime adjustment. "
              "Install with: xcode-select --install", file=sys.stderr)

    n_files = n_dirs = n_errors = 0
    targets: list[Path] = []

    for dirpath, dirnames, filenames in os.walk(root, topdown=True):
        # Prune skip dirs in place — os.walk respects this when topdown=True
        dirnames[:] = [d for d in dirnames if d not in skip]
        cur = Path(dirpath)
        if cur != root:
            targets.append(cur)
        for name in filenames:
            if name in skip:
                continue
            targets.append(cur / name)

    print(f"Root:    {root}")
    print(f"Target:  {args.date} {args.time}  (epoch {int(epoch)})")
    print(f"Skipping: {sorted(skip)}")
    print(f"Found {len(targets)} entries to update.")
    if args.dry_run:
        print("[dry-run] No changes made.")
        return 0

    for p in targets:
        try:
            os.utime(p, (epoch, epoch), follow_symlinks=False)
            if setfile is not None and not p.is_symlink():
                set_birthtime_macos(setfile, p, args.date, args.time)
            if p.is_dir():
                n_dirs += 1
            else:
                n_files += 1
            if not args.quiet:
                print(f"  ok  {p}")
        except Exception as e:
            n_errors += 1
            print(f"  err {p} -> {e}", file=sys.stderr)

    print()
    print(f"Updated {n_files} file(s) and {n_dirs} folder(s).  errors: {n_errors}")
    return 0 if n_errors == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
