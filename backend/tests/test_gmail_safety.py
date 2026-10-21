"""Gmail never-delete guarantee. Runs during the Docker build (see Dockerfile),
so a change that breaks any of these rules cannot be deployed.

Run locally:  cd backend && uv run python -m unittest discover -s tests -v
"""

import pathlib
import re
import sys
import unittest

BACKEND = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from services.gmail_organizer import (  # noqa: E402
    BULK_LIMIT,
    GmailGuardError,
    _restore_plan,
    validate_change,
    validate_label_name,
)

ORGANIZER = BACKEND / 'services' / 'gmail_organizer.py'

# Gmail API calls that trash, delete, send or draft mail, or touch account settings,
# plus the full-access scope that permits permanent deletion. Never allowed anywhere.
FORBIDDEN = [
    r'\.trash\s*\(', r'\.untrash\s*\(', r'\.batchDelete\s*\(', r'messages\(\)\s*\.\s*delete\s*\(',
    r'threads\(\)\s*\.\s*(delete|trash|modify)\s*\(', r'\.send\s*\(', r'\.drafts\s*\(', r'\.settings\s*\(',
    r'labels\(\)\s*\.\s*(delete|patch|update)\s*\(', r'https://mail\.google\.com/',
]
# Gmail write calls that are allowed, but only inside gmail_organizer.py.
ORGANIZER_ONLY = [r'\.batchModify\s*\(', r'messages\(\)\s*\.\s*modify\s*\(', r'labels\(\)\s*\.\s*create\s*\(']


def backend_sources():
    for path in BACKEND.rglob('*.py'):
        rel = path.relative_to(BACKEND).parts
        if rel[0] in ('.venv', 'tests') or '__pycache__' in rel:
            continue
        yield path, path.read_text()


class StaticSafety(unittest.TestCase):
    def test_no_trash_delete_send_or_full_scope_anywhere(self):
        for path, src in backend_sources():
            code = '\n'.join(line for line in src.splitlines() if not line.lstrip().startswith('#'))
            for pattern in FORBIDDEN:
                if path == ORGANIZER and pattern == r'https://mail\.google\.com/':
                    code_wo_doc = re.sub(r'"""[\s\S]*?"""', '', code)  # the module docstring explains the scope
                    self.assertIsNone(re.search(pattern, code_wo_doc), f'{path}: {pattern}')
                    continue
                self.assertIsNone(re.search(pattern, code), f'{path.relative_to(BACKEND)} uses forbidden Gmail call {pattern}')

    def test_gmail_writes_only_in_organizer(self):
        for path, src in backend_sources():
            if path == ORGANIZER:
                continue
            for pattern in ORGANIZER_ONLY:
                self.assertIsNone(re.search(pattern, src), f'{path.relative_to(BACKEND)} writes to Gmail outside gmail_organizer.py ({pattern})')

    def test_scope_is_gmail_modify_only(self):
        src = (BACKEND / 'services' / 'gmail_service.py').read_text()
        self.assertIn("SCOPES = ['https://www.googleapis.com/auth/gmail.modify']", src)


class Guard(unittest.TestCase):
    def test_trash_and_spam_can_never_be_added(self):
        for label in ('TRASH', 'SPAM'):
            with self.assertRaises(GmailGuardError):
                validate_change([label], [], 1)
            with self.assertRaises(GmailGuardError):
                validate_change([label], [], 1, confirm_bulk=True)

    def test_only_inbox_among_system_labels(self):
        validate_change(['Label_1'], ['INBOX'], 1)          # move to folder
        validate_change(['INBOX'], ['Label_1'], 1)          # undo a move
        for label in ('UNREAD', 'STARRED', 'IMPORTANT', 'SENT', 'DRAFT', 'CATEGORY_PROMOTIONS'):
            with self.assertRaises(GmailGuardError):
                validate_change([label], [], 1)
            with self.assertRaises(GmailGuardError):
                validate_change([], [label], 1)

    def test_bulk_needs_confirmation(self):
        validate_change(['Label_1'], [], BULK_LIMIT)
        with self.assertRaises(GmailGuardError):
            validate_change(['Label_1'], [], BULK_LIMIT + 1)
        validate_change(['Label_1'], [], BULK_LIMIT + 1, confirm_bulk=True)

    def test_empty_selection_rejected(self):
        with self.assertRaises(GmailGuardError):
            validate_change(['Label_1'], [], 0)

    def test_reserved_folder_names_rejected(self):
        for name in ('Trash', 'spam', 'INBOX', '', '   '):
            with self.assertRaises(GmailGuardError):
                validate_label_name(name)
        self.assertEqual(validate_label_name('  AI-Digest/Agents '), 'AI-Digest/Agents')


class UndoPlan(unittest.TestCase):
    def test_undo_restores_only_touched_labels(self):
        before = {'m1': ['INBOX', 'UNREAD', 'Label_x'], 'm2': ['INBOX']}
        # action: moved both to Label_new (added Label_new, removed INBOX); afterwards user starred m2 elsewhere
        now = {'m1': ['UNREAD', 'Label_x', 'Label_new'], 'm2': ['Label_new', 'STARRED']}
        plan = _restore_plan(before, now, touched={'Label_new', 'INBOX'})
        self.assertEqual(plan, {(('INBOX',), ('Label_new',)): ['m1', 'm2']})  # STARRED / UNREAD / Label_x untouched

    def test_undo_plan_never_adds_trash(self):
        before = {'m1': ['INBOX']}
        now = {'m1': ['Label_new']}
        for (add, _remove) in _restore_plan(before, now, {'Label_new', 'INBOX'}):
            self.assertNotIn('TRASH', add)


if __name__ == '__main__':
    unittest.main()
