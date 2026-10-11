"""Team guard for a Hermes member (S1). A pre_tool_call shell hook: Hermes runs it before write_file, patch, terminal and
delegate_task, and it prints a block directive when the team's rules refuse the call.

It mirrors judge() and judgeTeamFiles() in team-orchestrator/hooks/guard.ts, and reads the roster the mod writes
(.claude/team-orchestrator/roster.json). It never reads what the person typed: a #allow-write or #allow-subagent in a
Hermes tab grants nothing. Only the roster switches Allow writes and Allow subagents, set by the team top in Settings.

Wire it in the Hermes config (this file does not edit any config):

    hooks:
      pre_tool_call:
        - command: "<hermes venv python> <path to>/guard.py"
          matcher: "write_file|patch|terminal|delegate_task"
          fail_closed: true

Exit 0 with a {"action": "block", "message": ...} line on stdout to refuse; exit 0 with nothing to allow. Any error
exits 1, which fail_closed turns into a block. A session that is not on the roster is never judged.

Not ported (limits): the memory-folder exception of judge(), since Hermes keeps its memory elsewhere; and the held-session
guard, since Hermes has no member_claim hold.
"""

import json
import os
import re
import sys

WRITE_TOOLS = ("write_file", "patch")
TEAM_DIR = re.compile(r"^(team-orchestrator|team-o~\d+)$")
TEAM_FILE = re.compile(r"^(roster\.json|settings\.json|meta\.json|roster~\d+\.jso|settin~\d+\.jso|meta~\d+\.jso)$")
CHANGES_DIR = re.compile(r"^(changes|change~\d+|requests)$")
READERS = re.compile(r"^(cat|type|get-content|gc|ls|dir|get-childitem|gci|grep|select-string|sls|jq)$")
HARMLESS = re.compile(r"\d?>>?\s*(&\d|/dev/null|\$null|nul)(?=$|[\s;|&)])", re.IGNORECASE)
LOCKED = ".claude/team-orchestrator/roster.json, settings.json, meta.json, changes/ and requests/"
TAIL = (
    f"Only the team top and the Team Orchestrator itself change {LOCKED}; "
    "ask the team top, or the user (Settings in the Team Orchestrator panel)."
)


def _plain(segment):
    """One path segment as Windows reads it: no alternate stream (":$DATA"), no trailing dots or spaces."""
    return re.sub(r"[. ]+$", "", re.sub(r":.*$", "", segment))


def is_team_file_path(path):
    """The path is roster.json, settings.json or meta.json in a team-orchestrator folder, or a file in its changes/ or
    requests/ folder. '.' and '..' are folded; 8.3 names count."""
    segs = []
    for s in path.replace("\\", "/").lower().split("/"):
        if s in ("", "."):
            continue
        if s == "..":
            if segs:
                segs.pop()
        else:
            segs.append(s)
    n = len(segs)
    if n >= 3 and CHANGES_DIR.match(_plain(segs[n - 2])) and TEAM_DIR.match(_plain(segs[n - 3])):
        return True
    return n >= 2 and bool(TEAM_FILE.match(_plain(segs[n - 1]))) and bool(TEAM_DIR.match(_plain(segs[n - 2])))


def names_team_file(command):
    """The command names a team file: roster.json anywhere; settings.json or meta.json with the team folder; the team
    folder in one word with a wildcard, a variable or a substitution; or a change into the team folder."""
    c = command.replace("\\", "/").lower()
    team = re.search(r"team-orchestrator|team-o~\d", c)
    if re.search(r"roster(\.json|~\d)", c):
        return True
    if re.search(r"(team-orchestrator|team-o~\d)/+(changes|change~\d|requests)\b", c):
        return True
    if team and re.search(r"meta(\.json|~\d)", c):
        return True
    if re.search(r"settin(gs\.json|~\d)", c) and (team or re.search(r"(^|[\s'\"=(,;|&<>])settings\.json", c)):
        return True
    if re.search(r"(^|[\s;|&(])(cd|chdir|pushd|sl|set-location)\s[^;|&\n]*(team-orchestrator|team-o~\d)", c):
        return True
    for word in re.finditer(r"\S*(team-orchestrator|team-o~\d)\S*", c):
        if re.search(r"[*?\[\]{}$`]", word.group(0)):
            return True
    return False


def not_read_only(command):
    """Why the command is not plainly read-only, or '' when it is: only cat, type, Get-Content, ls, dir, grep,
    Select-String or jq (without -i)."""
    if re.search(r"`|\$\(|\$\{|<\(|>\(", command):
        return "it runs a substitution, so what it does is unclear"
    c = re.sub(r"'[^']*'|\"[^\"]*\"", " Q ", command)
    c = HARMLESS.sub(" ", c)
    if re.search(r"['\"]", c):
        return "its quoting is unbalanced, so what it does is unclear"
    if ">" in c:
        return "it redirects output into a file"
    c = re.sub(r"<\s*\S+", " ", c)
    parts = [p.strip() for p in re.split(r"&&|\|\||[;|&\n\r]", c)]
    parts = [p for p in parts if p != ""]
    if not parts:
        return "it is empty"
    for p in parts:
        words = p.split()
        first = words[0].lower()
        if not READERS.match(first):
            return f'it runs "{first}", which is not a plain read (cat, type, Get-Content, ls, dir, grep, Select-String, jq)'
        if first == "jq" and any(w == "--in-place" or re.match(r"^-[a-z]*i[a-z]*$", w, re.IGNORECASE) for w in words):
            return "it runs jq -i, which writes in place"
    return ""


def find_member(roster, session_id, handle):
    """The roster row for this session: by session id first, else by the Orca tab handle. None when not on the roster."""
    if session_id:
        for m in roster:
            if m.get("sessionId") and m["sessionId"] == session_id:
                return m
    if handle:
        for m in roster:
            if m.get("handle") and m["handle"] == handle:
                return m
    return None


def decide(payload, roster, handle=""):
    """The block message for this call, or None to let it through. Pure: the roster and the tab handle are passed in."""
    me = find_member(roster, payload.get("session_id") or "", handle)
    if me is None:
        return None
    name = me.get("name", "")
    top = me.get("boss") == "user"
    args = payload.get("tool_input") or {}
    tool = payload.get("tool_name") or ""
    if tool in WRITE_TOOLS:
        path = str(args.get("path") or args.get("file_path") or "")
        if not top and is_team_file_path(path):
            return f"Blocked {tool}: {name} may not change the team file {path}. {TAIL}"
        has_reports = any(x is not me and x.get("boss") == name for x in roster)
        if has_reports and not me.get("allowWrite"):
            return (
                f"Blocked {tool}: {name} has reports, so it does not write files itself. Hand the work to your worker, "
                "or ask the team top to switch Allow writes on in team Settings. A typed #allow-write does not count here."
            )
        return None
    if tool == "terminal":
        command = str(args.get("command") or "")
        if not top and names_team_file(command):
            why = not_read_only(command)
            if why:
                return (
                    f"Blocked terminal: this command names a team file ({LOCKED}) and is not plainly read-only: {why}. "
                    f"{name} may only read them, one plain command at a time. {TAIL}"
                )
        return None
    if tool == "delegate_task":
        if me.get("allowAgent"):
            return None
        return (
            f"Blocked delegate_task: {name} has no subagent permission. Hand the work to your worker with SendMessage, "
            "or ask the team top to switch Allow subagents on in team Settings. A typed #allow-subagent does not count here."
        )
    return None


def main(stdin=sys.stdin, stdout=sys.stdout):
    payload = json.load(stdin)
    root = payload.get("cwd") or os.getcwd()
    roster_path = os.environ.get("TEAM_ROSTER") or os.path.join(root, ".claude", "team-orchestrator", "roster.json")
    if not os.path.exists(roster_path):
        return 0
    with open(roster_path, encoding="utf-8") as f:
        roster = json.load(f)
    if not isinstance(roster, list):
        raise ValueError("roster.json is not a list of members")
    reason = decide(payload, roster, os.environ.get("ORCA_TERMINAL_HANDLE", "").strip())
    if reason:
        stdout.write(json.dumps({"action": "block", "message": reason}) + "\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # any error: exit 1, which the fail_closed hook turns into a block
        sys.stderr.write(f"team guard error: {exc}\n")
        sys.exit(1)
