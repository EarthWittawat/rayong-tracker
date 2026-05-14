"""Strip local filesystem paths from Jupyter notebook outputs.

Per the repo's commit hygiene rule, the user's local path
(D:\\Github\\rayong-tracker\\) must not appear in committed docs.
Notebook execution outputs include those paths whenever the code prints
absolute paths (e.g. "saved LoRA -> ..."). This script walks every
outputs[*].text in every cell of a notebook and removes the offending
prefix in place. Run before staging the notebook.
"""

from __future__ import annotations
import json
import sys
from pathlib import Path

WIN_PREFIX = "D:" + chr(92) + "Github" + chr(92) + "rayong-tracker" + chr(92)
POSIX_PREFIX = "D:/Github/rayong-tracker/"


def _scrub(t: str) -> str:
    return t.replace(WIN_PREFIX, "").replace(POSIX_PREFIX, "")


def scrub(path: Path) -> int:
    nb = json.loads(path.read_text(encoding="utf-8"))
    n = 0
    for cell in nb["cells"]:
        for out in cell.get("outputs", []) or []:
            text = out.get("text")
            if isinstance(text, list):
                new = []
                for line in text:
                    s = _scrub(line)
                    if s != line:
                        n += 1
                    new.append(s)
                out["text"] = new
            elif isinstance(text, str):
                s = _scrub(text)
                if s != text:
                    n += 1
                out["text"] = s
    if n:
        path.write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return n


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("notebooks/pipeline.ipynb")
    fixed = scrub(target)
    print(f"scrubbed {fixed} output lines in {target}")
