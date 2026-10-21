"""The ONLY module allowed to change anything in Gmail.

Safety model (see documents/architecture/features/12-gmail-organize-design-2026-10-08.md):
  1. Permanent deletion is impossible by OAuth scope: messages.delete/batchDelete
     need https://mail.google.com/; the app holds gmail.modify only.
  2. gmail.modify still allows trash, spam, send and drafts. None of those
     operations exist in this module, and tests/test_gmail_safety.py fails the
     build (it runs in the Dockerfile) if any backend code references them, or if
     any file other than this one calls a Gmail write method.
  3. validate_change() guards every label change: TRASH/SPAM can never be
     added, the only system label that may be added or removed is INBOX ("move to
     folder" = add a user label + remove INBOX; undo re-adds INBOX), and changes
     above BULK_LIMIT messages need an explicit confirm_bulk flag.
  4. Every user-initiated change is recorded in Supabase gmail_actions with each
     message's labels *before* the change, so undo_action() can restore exactly
     the labels that action touched. Nothing ever leaves All Mail.
"""

import asyncio
import json
import time
import uuid

from services.db import get_pool

FORBIDDEN_LABELS = frozenset({'TRASH', 'SPAM'})
SYSTEM_LABELS_ALLOWED = frozenset({'INBOX'})
BULK_LIMIT = 200
USER_LABEL_PREFIX = 'Label_'  # Gmail ids for user-created labels; system labels are UPPERCASE names


class GmailGuardError(ValueError):
    """A requested change is not allowed by the organizer's safety rules."""


def _is_user_label(label_id: str) -> bool:
    return label_id.startswith(USER_LABEL_PREFIX)


def validate_change(add_ids: list[str], remove_ids: list[str], message_count: int, confirm_bulk: bool = False) -> None:
    if message_count == 0:
        raise GmailGuardError('No messages selected')
    if message_count > BULK_LIMIT and not confirm_bulk:
        raise GmailGuardError(f'Changing more than {BULK_LIMIT} emails at once needs explicit confirmation')
    for label_id in add_ids:
        if label_id in FORBIDDEN_LABELS:
            raise GmailGuardError(f'Adding {label_id} is never allowed')
        if not _is_user_label(label_id) and label_id not in SYSTEM_LABELS_ALLOWED:
            raise GmailGuardError(f'Adding system label {label_id} is not allowed')
    for label_id in remove_ids:
        if not _is_user_label(label_id) and label_id not in SYSTEM_LABELS_ALLOWED:
            raise GmailGuardError(f'Removing system label {label_id} is not allowed')


def validate_label_name(name: str) -> str:
    name = (name or '').strip()
    if not name or len(name) > 200:
        raise GmailGuardError('Folder name must be 1–200 characters')
    if name.upper() in FORBIDDEN_LABELS | SYSTEM_LABELS_ALLOWED | {'SENT', 'DRAFT', 'STARRED', 'IMPORTANT', 'UNREAD'}:
        raise GmailGuardError(f'"{name}" is a reserved Gmail name')
    return name


# ── Synchronous Gmail calls (run via asyncio.to_thread) ──────────────────────

def list_user_labels(service) -> list[dict]:
    result = service.users().labels().list(userId='me').execute()
    return sorted(
        ({'id': lbl['id'], 'name': lbl['name']} for lbl in result.get('labels', []) if lbl.get('type') == 'user'),
        key=lambda l: l['name'].lower(),
    )


def ensure_label(service, name: str) -> str:
    """Return the id of the user label `name`, creating it if needed."""
    name = validate_label_name(name)
    for label in list_user_labels(service):
        if label['name'].lower() == name.lower():
            return label['id']
    body = {'name': name, 'labelListVisibility': 'labelShow', 'messageListVisibility': 'show'}
    return service.users().labels().create(userId='me', body=body).execute()['id']


def _labels_of(service, message_ids: list[str]) -> dict[str, list[str]]:
    return {
        mid: service.users().messages().get(userId='me', id=mid, format='minimal', fields='labelIds').execute().get('labelIds', [])
        for mid in message_ids
    }


def _batch_modify(service, message_ids: list[str], add_ids: list[str], remove_ids: list[str]) -> None:
    for i in range(0, len(message_ids), 1000):
        service.users().messages().batchModify(
            userId='me',
            body={'ids': message_ids[i:i + 1000], 'addLabelIds': add_ids, 'removeLabelIds': remove_ids},
        ).execute()


def add_label(service, message_ids: list[str], label_id: str) -> None:
    """Guarded, unaudited add of one user label (the digest's own gmail-ai-digested marker)."""
    if not message_ids:
        return
    validate_change([label_id], [], len(message_ids), confirm_bulk=True)
    _batch_modify(service, message_ids, [label_id], [])


def _restore_plan(before: dict[str, list[str]], now: dict[str, list[str]], touched: set[str]) -> dict[tuple, list[str]]:
    """Per message: put back exactly the touched labels' prior state; group messages by identical change."""
    plan: dict[tuple, list[str]] = {}
    for mid, previous in before.items():
        current = set(now.get(mid, []))
        target = (current - touched) | (set(previous) & touched)
        add, remove = tuple(sorted(target - current)), tuple(sorted(current - target))
        if add or remove:
            plan.setdefault((add, remove), []).append(mid)
    return plan


# ── Audited, async operations (called by the HTTP endpoints) ─────────────────

async def _record(kind: str, actor: str, message_ids: list[str], add_ids: list[str], remove_ids: list[str],
                  label_names: list[str], before: dict[str, list[str]]) -> str:
    action_id = str(uuid.uuid4())
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO gmail_actions (id, kind, actor, message_ids, added_label_ids, removed_label_ids, label_names, before, created_at) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)",
            action_id, kind, actor, message_ids, add_ids, remove_ids, label_names, json.dumps(before), int(time.time() * 1000),
        )
    return action_id


async def apply_groups(service, kind: str, actor: str, groups: list[dict], move: bool, confirm_bulk: bool = False) -> dict:
    """groups: [{'label': 'AI-Digest/Agents', 'message_ids': [...]}]. Labels each group (creating labels as
    needed); with move=True also removes INBOX. One audited action covering every group."""
    all_ids = sorted({mid for g in groups for mid in g['message_ids']})
    label_ids = [await asyncio.to_thread(ensure_label, service, g['label']) for g in groups]
    remove = ['INBOX'] if move else []
    validate_change(label_ids, remove, len(all_ids), confirm_bulk)
    before = await asyncio.to_thread(_labels_of, service, all_ids)
    for group, label_id in zip(groups, label_ids):
        await asyncio.to_thread(_batch_modify, service, group['message_ids'], [label_id], remove)
    action_id = await _record(kind, actor, all_ids, label_ids, remove, [g['label'] for g in groups], before)
    return {'action_id': action_id, 'messages': len(all_ids), 'labels': [g['label'] for g in groups], 'moved': move}


async def undo_action(service, action_id: str, actor: str) -> dict:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM gmail_actions WHERE id = $1", action_id)
    if row is None:
        raise GmailGuardError('Unknown action')
    if row['undone_at'] is not None:
        raise GmailGuardError('This action was already undone')
    before = json.loads(row['before'])
    touched = set(row['added_label_ids']) | set(row['removed_label_ids'])
    now = await asyncio.to_thread(_labels_of, service, list(before))
    plan = _restore_plan(before, now, touched)
    for (add, remove), message_ids in plan.items():
        validate_change(list(add), list(remove), len(message_ids), confirm_bulk=True)
        await asyncio.to_thread(_batch_modify, service, message_ids, list(add), list(remove))
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE gmail_actions SET undone_at = $2, undone_by = $3 WHERE id = $1",
            action_id, int(time.time() * 1000), actor,
        )
    return {'action_id': action_id, 'restored_messages': sum(len(v) for v in plan.values())}


async def list_actions(limit: int = 20) -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, kind, actor, cardinality(message_ids) AS messages, label_names, removed_label_ids, created_at, undone_at, undone_by "
            "FROM gmail_actions ORDER BY created_at DESC LIMIT $1",
            limit,
        )
    return [
        {
            'id': r['id'], 'kind': r['kind'], 'actor': r['actor'], 'messages': r['messages'],
            'labels': list(r['label_names']), 'moved': 'INBOX' in r['removed_label_ids'],
            'created_at': r['created_at'], 'undone_at': r['undone_at'], 'undone_by': r['undone_by'],
        }
        for r in rows
    ]
