"""Tests for guard.py (S1). Run: python -m unittest discover -s team-orchestrator/hermes -p "test_*.py"

These are plain unittest tests, not the mod's claude plugin test (that runner only reads *.test.ts)."""

import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import guard  # noqa: E402

ROSTER = [
    {"name": "Head", "boss": "user", "sessionId": "sid-head", "handle": "term_h", "allowWrite": False, "allowAgent": False},
    {"name": "Worker", "boss": "Head", "sessionId": "sid-w", "handle": "term_w", "allowWrite": False, "allowAgent": False},
]
ROSTER_FILE = ".claude/team-orchestrator/roster.json"


def call(sid, tool, args, handle=""):
    payload = {"hook_event_name": "pre_tool_call", "tool_name": tool, "tool_input": args, "session_id": sid, "cwd": "C:/proj"}
    return guard.decide(payload, copy.deepcopy(ROSTER), handle)


class TeamFilePaths(unittest.TestCase):
    def test_team_files_however_spelt(self):
        for p in [
            ".claude/team-orchestrator/roster.json",
            "C:\\proj\\.claude\\team-orchestrator\\settings.json",
            "c:/PROJ/.Claude/Team-Orchestrator/Settings.JSON",
            "C:/proj/.claude/team-orchestrator/status/../roster.json",
            "C:/proj/.claude/team-orchestrator/./settings.json",
            "C:/proj/.claude/team-orchestrator//roster.json",
            "C:/proj/.claude/team-orchestrator/roster.json.",
            "C:/proj/.claude/team-orchestrator/roster.json::$DATA",
            "C:/proj/CLAUDE~1/TEAM-O~1/ROSTER~1.JSO",
            "C:/proj/.claude/team-orchestrator/changes/1-a.json",
        ]:
            self.assertTrue(guard.is_team_file_path(p), p)

    def test_other_files_are_not_team_files(self):
        for p in [
            "C:/proj/.claude/team-orchestrator/status/W1.json",
            "C:/proj/.claude/team-orchestrator/roles/W1.md",
            "C:/proj/.claude/settings.json",
            "C:/proj/src/roster.json",
            "",
        ]:
            self.assertFalse(guard.is_team_file_path(p), p)


class ShellCommands(unittest.TestCase):
    def test_names_a_team_file(self):
        for c in [
            "echo [] > .claude/team-orchestrator/roster.json",
            "Set-Content -Path .claude\\team-orchestrator\\settings.json -Value x",
            "rm .claude/team-orchestrator/*.json",
            "cp x $D/team-orchestrator/a",
            "cd .claude/team-orchestrator && rm *.json",
            "Set-Location .claude/team-orchestrator; Remove-Item *",
            "rm -r .claude/team-orchestrator/changes",
        ]:
            self.assertTrue(guard.names_team_file(c), c)

    def test_words_that_only_mention_the_team_name_name_no_team_file(self):
        for c in [
            "echo roster",
            "git -C C:/proj/repo log --oneline",
            "cd C:/proj && claude plugin test team-orchestrator",
            "claude plugin test team-orchestrator 2>&1 | grep -E \"fail|[0-9]+ *pass\"",
            "cat ~/.claude/settings.json",
            "rm .claude/team-orchestrator/status/W1.json",
            "npm test",
        ]:
            self.assertFalse(guard.names_team_file(c), c)

    def test_plain_reads_pass_and_writes_do_not(self):
        for c in [
            "cat .claude/team-orchestrator/roster.json",
            "Get-Content .claude/team-orchestrator/settings.json -Raw",
            "grep -n allowWrite .claude/team-orchestrator/roster.json",
            "cat .claude/team-orchestrator/roster.json 2>/dev/null",
        ]:
            self.assertEqual(guard.not_read_only(c), "", c)
        for c in [
            "echo [] > .claude/team-orchestrator/roster.json",
            "cat x >> .claude/team-orchestrator/roster.json",
            "sed -i s/false/true/ .claude/team-orchestrator/roster.json",
            "jq -i .x .claude/team-orchestrator/roster.json",
            "cat .claude/team-orchestrator/roster.json; rm x",
            "cat $(echo .claude/team-orchestrator/roster.json)",
        ]:
            self.assertNotEqual(guard.not_read_only(c), "", c)


class Rules(unittest.TestCase):
    def test_session_not_on_roster_is_never_judged(self):
        self.assertIsNone(call("sid-other", "write_file", {"path": ROSTER_FILE, "content": "x"}))
        self.assertIsNone(call("sid-other", "terminal", {"command": "rm -r .claude/team-orchestrator/changes"}))

    def test_worker_writes_a_source_file(self):
        self.assertIsNone(call("sid-w", "write_file", {"path": "src/a.py", "content": "x"}))

    def test_head_with_reports_is_refused_writes_until_allow_writes_is_on(self):
        msg = call("sid-head", "write_file", {"path": "src/a.py", "content": "x"})
        self.assertIn("does not write files itself", msg)
        self.assertIn("Blocked write_file: Head has reports", msg)
        roster = copy.deepcopy(ROSTER)
        roster[0]["allowWrite"] = True
        payload = {"tool_name": "write_file", "tool_input": {"path": "src/a.py"}, "session_id": "sid-head"}
        self.assertIsNone(guard.decide(payload, roster))

    def test_typed_grant_in_the_call_grants_nothing(self):
        msg = call("sid-head", "patch", {"path": "src/a.py", "content": "#allow-write please"})
        self.assertIn("does not write files itself", msg)

    def test_worker_may_not_write_a_team_file(self):
        msg = call("sid-w", "write_file", {"path": ROSTER_FILE, "content": "[]"})
        self.assertIn("may not change the team file", msg)

    def test_top_passes_the_team_file_rule_but_a_boss_still_needs_allow_writes(self):
        # guard.ts runs judge() after judgeTeamFiles() returns nothing for the team top, so the top with reports
        # is still refused writes until Allow writes is on. The team-file rule itself does not refuse the top.
        msg = call("sid-head", "write_file", {"path": ROSTER_FILE, "content": "[]"})
        self.assertNotIn("may not change the team file", msg)
        self.assertIn("has reports", msg)
        roster = copy.deepcopy(ROSTER)
        roster[0]["allowWrite"] = True
        payload = {"tool_name": "write_file", "tool_input": {"path": ROSTER_FILE}, "session_id": "sid-head"}
        self.assertIsNone(guard.decide(payload, roster))

    def test_terminal_plain_read_of_a_team_file_passes(self):
        self.assertIsNone(call("sid-w", "terminal", {"command": "cat .claude/team-orchestrator/roster.json"}))

    def test_terminal_writes_to_a_team_file_are_refused(self):
        for cmd in [
            "echo [] > .claude/team-orchestrator/roster.json",
            "cd .claude/team-orchestrator && rm *.json",
            "rm -r .claude/team-orchestrator/changes",
        ]:
            self.assertIn("names a team file", call("sid-w", "terminal", {"command": cmd}), cmd)

    def test_terminal_words_only_pass(self):
        self.assertIsNone(call("sid-w", "terminal", {"command": "claude plugin test team-orchestrator 2>&1 | grep -E \"fail|[0-9]+ *pass\""}))

    def test_delegate_task_needs_allow_subagents(self):
        self.assertIn("no subagent permission", call("sid-w", "delegate_task", {"goal": "look"}))
        roster = copy.deepcopy(ROSTER)
        roster[1]["allowAgent"] = True
        self.assertIsNone(guard.decide({"tool_name": "delegate_task", "tool_input": {}, "session_id": "sid-w"}, roster))

    def test_member_found_by_tab_handle_when_the_session_id_is_missing(self):
        self.assertIn("Blocked write_file: Worker", call("", "write_file", {"path": ROSTER_FILE}, handle="term_w"))

    def test_other_tools_are_not_judged(self):
        self.assertIsNone(call("sid-w", "read_file", {"path": ROSTER_FILE}))


class EndToEnd(unittest.TestCase):
    def run_hook(self, payload_text, cwd):
        env = dict(os.environ, ORCA_TERMINAL_HANDLE="")
        return subprocess.run(
            [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "guard.py")],
            input=payload_text, capture_output=True, text=True, cwd=cwd, env=env,
        )

    def test_block_directive_on_stdout_and_exit_zero(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, ".claude", "team-orchestrator"))
            with open(os.path.join(root, ROSTER_FILE), "w", encoding="utf-8") as f:
                json.dump(ROSTER, f)
            payload = json.dumps({"tool_name": "write_file", "tool_input": {"path": ROSTER_FILE}, "session_id": "sid-w", "cwd": root})
            r = self.run_hook(payload, root)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(json.loads(r.stdout)["action"], "block")

    def test_allowed_call_prints_nothing(self):
        with tempfile.TemporaryDirectory() as root:
            os.makedirs(os.path.join(root, ".claude", "team-orchestrator"))
            with open(os.path.join(root, ROSTER_FILE), "w", encoding="utf-8") as f:
                json.dump(ROSTER, f)
            payload = json.dumps({"tool_name": "write_file", "tool_input": {"path": "src/a.py"}, "session_id": "sid-w", "cwd": root})
            r = self.run_hook(payload, root)
            self.assertEqual((r.returncode, r.stdout), (0, ""))

    def test_no_roster_means_nothing_is_judged(self):
        with tempfile.TemporaryDirectory() as root:
            payload = json.dumps({"tool_name": "write_file", "tool_input": {"path": ROSTER_FILE}, "session_id": "sid-w", "cwd": root})
            r = self.run_hook(payload, root)
            self.assertEqual((r.returncode, r.stdout), (0, ""))

    def test_bad_input_exits_one_so_fail_closed_blocks(self):
        with tempfile.TemporaryDirectory() as root:
            r = self.run_hook("not json", root)
            self.assertEqual(r.returncode, 1)
            self.assertIn("team guard error", r.stderr)


if __name__ == "__main__":
    unittest.main()
