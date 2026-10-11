"""S4 re-check: after `hermes update`, does the installed Hermes still carry the team patches? Read-only.

Usage: python patch_check.py [<hermes-agent dir>]
Default dir: %LOCALAPPDATA%\\hermes\\hermes-agent.

It never writes, never applies a patch and never restarts Hermes. Re-applying needs the user's Yes.

Exit 0: all five files carry their markers, and the git diff is the expected 5 files, +32/-5.
Exit 1: WARN. Some or all of the patch is missing (listed). Re-apply needs the user's Yes.
Exit 2: cannot check (no directory, or no git checkout there).
"""

import os
import re
import subprocess
import sys

EXPECTED_FILES = {"agent/shell_hooks.py", "hermes_cli/plugins.py", "agent/tool_executor.py", "agent/agent_runtime_helpers.py", "model_tools.py"}
EXPECTED_ADD, EXPECTED_DEL = 32, 5

# one marker per changed site; a file with none of its markers is "gone", a file with some is "partial"
MARKERS = {
    "agent/shell_hooks.py": [r"def pre_tool_call_fail_closed\(", r"callback\._hermes_fail_closed = spec\.fail_closed"],
    "hermes_cli/plugins.py": [r"turn_author: Optional\[(Dict|dict)\[str, Any\]\] = None,", r"turn_author=turn_author,"],
    "agent/tool_executor.py": [r'turn_author=getattr\(agent, "_turn_author", None\),', r"pre_tool_call_fail_closed\(\):"],
    "agent/agent_runtime_helpers.py": [r'turn_author=getattr\(agent, "_turn_author", None\),', r"pre_tool_call_fail_closed\(\):"],
    "model_tools.py": [r"from agent\.shell_hooks import pre_tool_call_fail_closed", r"if pre_tool_call_fail_closed\(\):"],
}


def default_dir():
    return os.path.join(os.environ.get("LOCALAPPDATA", ""), "hermes", "hermes-agent")


def check_markers(root):
    """{path: (found, total, missing_patterns)} for each patched file; a missing file counts as nothing found."""
    out = {}
    for path, patterns in MARKERS.items():
        full = os.path.join(root, *path.split("/"))
        try:
            with open(full, encoding="utf-8") as f:
                text = f.read()
        except OSError:
            text = None
        missing = [p for p in patterns if text is None or not re.search(p, text)]
        out[path] = (len(patterns) - len(missing), len(patterns), missing)
    return out


def numstat(root, run=None):
    """(added, deleted, {path: (added, deleted)}) from `git diff --numstat`, or None when git cannot answer."""
    run = run or (lambda args: subprocess.run(["git", "-C", root] + args, capture_output=True, text=True))
    r = run(["diff", "--numstat"])
    if getattr(r, "returncode", 1) != 0:
        return None
    rows = {}
    for line in r.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            rows[parts[2]] = (int(parts[0]), int(parts[1]))
    return sum(a for a, _ in rows.values()), sum(d for _, d in rows.values()), rows


def report(root, run=None):
    """(exit_code, lines). Pure apart from reading the files and asking git; run is injectable for tests."""
    if not os.path.isdir(root):
        return 2, [f"CANNOT CHECK: no Hermes directory at {root}"]
    lines = [f"Hermes dir: {root}"]
    stat = numstat(root, run)
    if stat is None:
        return 2, lines + ["CANNOT CHECK: git could not read the diff here (not a git checkout?)"]
    added, deleted, rows = stat
    markers = check_markers(root)
    found_total = sum(f for f, _, _ in markers.values())
    need_total = sum(t for _, t, _ in markers.values())
    files_present = [p for p, (f, t, _) in markers.items() if f == t]
    lines.append(f"markers found: {found_total} of {need_total} (files complete: {len(files_present)} of {len(MARKERS)})")
    code = 0
    if found_total == 0:
        code = 1
        lines.append("WARN: the team patch is GONE from this install (no markers). Re-apply needs the user's Yes.")
    elif found_total < need_total:
        code = 1
        for p, (f, t, missing) in markers.items():
            if f < t:
                lines.append(f"WARN: {p}: {f} of {t} markers; missing {len(missing)}")
    if set(rows) != EXPECTED_FILES or (added, deleted) != (EXPECTED_ADD, EXPECTED_DEL):
        code = 1
        lines.append(f"WARN: diff is {added} insertions, {deleted} deletions in {len(rows)} files; expected {EXPECTED_ADD}, {EXPECTED_DEL} in 5 files")
    if code == 0:
        lines.append(f"OK: the team patch is present: 5 files, +{added} -{deleted}, all {need_total} markers found")
    return code, lines


def main(argv):
    root = argv[1] if len(argv) > 1 else default_dir()
    code, lines = report(root)
    print("\n".join(lines))
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv))
