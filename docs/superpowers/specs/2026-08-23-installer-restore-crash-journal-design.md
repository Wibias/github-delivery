# Installer restore crash journal

## Status

Approved 2026-08-23. Branch from current `origin/main`. GD-AUDIT-043 restore leftover only.

## Problem

Apply recover closed the displace window, but `restoreBackup` still renamed the live target aside and then the backup into place with no journal. A hard crash between those renames left no live target.

The apply journal was also rewritten in place (`openSync(..., "w")`). A crash after emptying that file left recover with no valid journal.

## Approach

1. Write the restore journal before the aside rename. Recover finishes the restore when the backup is intact, otherwise puts the aside copy back.
2. Replace the journal with a temp file plus rename so a crash cannot truncate the live journal.
3. Record the backup path before displacing the live target. If the journal is unreadable, recover may use a unique sibling staging or aside directory.

Do not change Authority cutover, lock policy, or source identity.

## Tests

- After a crash between restore aside and backup swap, recover leaves a live target.
- After a truncated journal following displace, recover still leaves a live target.
