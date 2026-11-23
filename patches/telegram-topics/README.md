# Patch: Telegram topics

## Why

Without this patch, all topics of one Telegram chat go into one shared session.
With the patch:

- a topic of a forum supergroup is its own thread (`telegram:<chatId>:<topicId>`);
- a topic of a private chat with the bot (threaded mode, Bot API 9.3) is its own thread;
- a reply chain in a normal group goes back to the chat thread;
- the bot replies in the topic that the message came from.

Full description: `../nanoclaw-telegram-topics.md` (in the homelab repository, outside this checkout).

## Upstream

- PR: <https://github.com/nanocoai/nanoclaw/pull/3971> "fix(telegram): route forum and private-chat topics as threads". Open on 2026-11-23.
- The adapter comes from the upstream `channels` branch through `/add-telegram`.
  `/add-telegram` and `/update-skills` overwrite `src/channels/telegram.ts`. After them, run
  `scripts/homelab/patches.sh check` and, if necessary, `apply`.

## Files

| File | Content |
|---|---|
| `patch.diff` | Changes in `src/channels/telegram.ts` and `src/channels/telegram-instances-registration.test.ts` |
| `files/src/channels/telegram-topics.test.ts` | New test |
| `check.sh` | Marker: `normalizeTopicThreadId` in `src/channels/telegram.ts` |

## Test

```bash
pnpm exec vitest run src/channels src/router
```

## When to delete

When `scripts/homelab/patches.sh check` shows `UPSTREAM yes` for this patch
(PR #3971 is in the `channels` branch): delete `patches/telegram-topics/`, run
`/add-telegram` again (or copy the adapter from the `channels` branch) and run the tests.

## If patch.diff does not apply

Move the changes by hand. Use the diff and the description in `../nanoclaw-telegram-topics.md`,
section 4.1. Then make a new diff:

```bash
git diff upstream/channels -- src/channels/telegram.ts src/channels/telegram-instances-registration.test.ts \
  > patches/telegram-topics/patch.diff
```

Open questions (from the topics document): `is_group=1` for the private chat, old topic sessions,
the `is_forum` cache has no expiry.
