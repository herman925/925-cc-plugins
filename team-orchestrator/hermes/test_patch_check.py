"""Tests for patch_check.py (S4). Run: python -m unittest discover -s <this folder> -p "test_patch_check.py" -t <this folder>

Uses temporary trees and a fake git runner. Nothing touches a real Hermes install."""

import os
import sys
import tempfile
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import patch_check  # noqa: E402

FULL_TEXT = {
    "agent/shell_hooks.py": "def pre_tool_call_fail_closed():\n    callback._hermes_fail_closed = spec.fail_closed\n",
    "hermes_cli/plugins.py": "    turn_author: Optional[Dict[str, Any]] = None,\n    turn_author=turn_author,\n",
    "agent/tool_executor.py": '    turn_author=getattr(agent, "_turn_author", None),\n    if pre_tool_call_fail_closed():\n',
    "agent/agent_runtime_helpers.py": '    turn_author=getattr(agent, "_turn_author", None),\n    if pre_tool_call_fail_closed():\n',
    "model_tools.py": "    from agent.shell_hooks import pre_tool_call_fail_closed\n    if pre_tool_call_fail_closed():\n",
}
EXPECTED_NUMSTAT = (
    "6\t1\tagent/agent_runtime_helpers.py\n"
    "13\t1\tagent/shell_hooks.py\n"
    "6\t2\tagent/tool_executor.py\n"
    "2\t0\thermes_cli/plugins.py\n"
    "5\t1\tmodel_tools.py\n"
)


def fake_git(stdout, returncode=0):
    return lambda args: SimpleNamespace(stdout=stdout, returncode=returncode)


def make_tree(root, texts):
    for path, text in texts.items():
        full = os.path.join(root, *path.split("/"))
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)


class PatchCheck(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_full_patch_is_ok(self):
        make_tree(self.root, FULL_TEXT)
        code, lines = patch_check.report(self.root, fake_git(EXPECTED_NUMSTAT))
        self.assertEqual(code, 0, lines)
        self.assertTrue(any(l.startswith("OK: the team patch is present") for l in lines), lines)
        self.assertIn("markers found: 10 of 10", lines[1])

    def test_patch_gone_is_a_warning(self):
        make_tree(self.root, {p: "print('plain upstream file')\n" for p in FULL_TEXT})
        code, lines = patch_check.report(self.root, fake_git(""))
        self.assertEqual(code, 1)
        self.assertIn("WARN: the team patch is GONE", "\n".join(lines))

    def test_partial_patch_names_the_file(self):
        texts = dict(FULL_TEXT)
        texts["hermes_cli/plugins.py"] = "    turn_author: Optional[Dict[str, Any]] = None,\n"  # signature only
        make_tree(self.root, texts)
        code, lines = patch_check.report(self.root, fake_git(EXPECTED_NUMSTAT))
        self.assertEqual(code, 1)
        self.assertIn("WARN: hermes_cli/plugins.py: 1 of 2 markers", "\n".join(lines))

    def test_diff_that_is_not_the_expected_patch_is_a_warning(self):
        make_tree(self.root, FULL_TEXT)
        code, lines = patch_check.report(self.root, fake_git("20\t5\tmodel_tools.py\n"))
        self.assertEqual(code, 1)
        self.assertIn("expected 32, 5 in 5 files", "\n".join(lines))

    def test_missing_directory_cannot_be_checked(self):
        code, lines = patch_check.report(os.path.join(self.root, "nope"), fake_git(""))
        self.assertEqual(code, 2)
        self.assertIn("CANNOT CHECK", lines[0])

    def test_git_failure_cannot_be_checked(self):
        make_tree(self.root, FULL_TEXT)
        code, lines = patch_check.report(self.root, fake_git("", returncode=128))
        self.assertEqual(code, 2)
        self.assertIn("git could not read the diff", "\n".join(lines))

    def read_all(self):
        out = {}
        for p in FULL_TEXT:
            with open(os.path.join(self.root, *p.split("/")), encoding="utf-8") as f:
                out[p] = f.read()
        return out

    def test_check_writes_nothing(self):
        make_tree(self.root, FULL_TEXT)
        before = self.read_all()
        patch_check.report(self.root, fake_git(EXPECTED_NUMSTAT))
        self.assertEqual(before, self.read_all())
        self.assertEqual(sorted(os.listdir(self.root)), sorted(["agent", "hermes_cli", "model_tools.py"]))


if __name__ == "__main__":
    unittest.main()
