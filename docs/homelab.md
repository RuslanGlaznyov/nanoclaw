# Форк homelab: что изменено и как обновлять

Ветка `homelab` = `main` (копия upstream) + наши коммиты. План: `plans/02-nanoclaw-fork.md` в репозитории homelab.

## Remotes и ветки

```text
upstream  https://github.com/nanocoai/nanoclaw.git   только fetch (push = DISABLED)
origin    git@github.com:RuslanGlaznyov/nanoclaw.git  приватный форк

main      точная копия upstream/main, своих коммитов нет
homelab   main + наши коммиты, рабочая ветка
```

Сообщения наших коммитов начинаются с `homelab:`. Коммиты мастера настройки — `setup: apply <навык>`.

## Что изменено

| Что | Где | Тип |
|---|---|---|
| Шлюз Iron Proxy из Ansible: заглушка, прокси и CA на группу | `.claude/skills/homelab-iron-proxy/` | Навык (новые файлы) + одна строка в `src/gateway-providers/installed.ts` |
| Своя заглушка группы в OpenCode (`NANOCLAW_CREDENTIAL_PLACEHOLDER`) | `patches/opencode-group-placeholder/` | Патч: payload `add-opencode` и установленная копия |
| Темы Telegram (upstream PR #3971) | `patches/telegram-topics/` | Патч адаптера из ветки `channels` |
| Правила оператора для группы (`data/homelab-guardrails/<folder>.md`, раздел `# Operator Policy` в начале промпта) | `patches/operator-policy/` | Патч `src/project-doc-compose.ts` + новый модуль `src/homelab-operator-policy.ts` |
| Скрипт патчей | `scripts/homelab/patches.sh`, `scripts/homelab/patch-lib.sh` | Новые файлы |

Применённые навыки: `add-opencode`, `add-telegram`, `homelab-iron-proxy`. Навык `add-onecli` не применён.

## Патчи

```bash
scripts/homelab/patches.sh check    # таблица: применён, есть ли в upstream, применяется ли diff
scripts/homelab/patches.sh apply    # применить неприменённые
scripts/homelab/patches.sh revert   # снять
```

`check` возвращает код 1, если хотя бы один патч не применён. Формат патча описан в начале `scripts/homelab/patches.sh`.
Если в столбце `UPSTREAM` стоит `yes`, удалите каталог патча (см. его `README.md`).

## Файлы на хосте (не в git)

| Файл | Кто пишет | Права |
|---|---|---|
| `.env`: `NANOCLAW_GATEWAY_PROVIDER=homelab-iron-proxy`, `OPENCODE_*`, `TELEGRAM_BOT_TOKEN` | setup / Ansible (план 3) | 0600 |
| `data/homelab-iron-proxy/routes.json` | Ansible (план 3) | 0644 |
| `data/homelab-iron-proxy/placeholders.env` | Ansible (план 3) | 0600, иначе агент не стартует |
| `data/gateway-trust/homelab-iron-ca.pem` | Ansible (план 3), копия `ansible-homelab/files/iron-proxy/ca.crt` | 0644 |
| `data/homelab-guardrails/<folder>.md` | Ansible, только для `role: member`. Агент файл не видит | 0644 |
| `data/upgrade-state.json` | `scripts/upgrade-state.ts set`, `/update-nanoclaw`, setup | — |

Формат `routes.json` и `placeholders.env`: `.claude/skills/homelab-iron-proxy/SKILL.md`.

## Метка обновления

Хост не стартует, если коммит и дерево в `data/upgrade-state.json` не совпадают с кодом
(«NanoClaw stopped: update did not go through the supported path»). После каждого своего
коммита в `homelab` на рабочем хосте:

```bash
pnpm exec tsx scripts/upgrade-state.ts set
```

Делайте это только после успешной сборки и тестов.

## Процедура обновления

1. Снимок контейнера Incus (план 3): `incus snapshot create app-nanoclaw pre-update-<дата>`.
2. Обновите `main`:
   ```bash
   git fetch upstream --prune
   git checkout main && git merge --ff-only upstream/main && git push origin main
   ```
3. Слейте в `homelab` и решите конфликты:
   ```bash
   git checkout homelab && git merge main
   ```
   Чаще всего конфликтуют:
   - `src/gateway-providers/installed.ts` — оставьте строку `import './homelab-iron-proxy.js';`;
   - payload `add-opencode` (`opencode-config.ts`) — сохраните патч `opencode-group-placeholder`;
   - `src/project-doc-compose.ts` — сохраните патч `operator-policy` (вызов `readOperatorPolicy`).
4. Запустите `/update-nanoclaw`. Он обновляет навыки в отдельном worktree. Обновление может
   перезаписать `src/channels/telegram.ts` и установленные файлы OpenCode.
5. Проверьте патчи и примените снова, если нужно:
   ```bash
   scripts/homelab/patches.sh check || scripts/homelab/patches.sh apply
   ```
   Если `DIFF` = `CONFLICT`, перенесите изменение вручную по `README.md` патча.
6. Сборка и тесты:
   ```bash
   pnpm run build
   pnpm exec vitest run src/gateway-providers src/channels src/router .claude/skills/homelab-iron-proxy \
     src/homelab-operator-policy.test.ts src/project-doc-compose.test.ts
   (cd container/agent-runner && bun test --isolate src/providers/opencode*.test.ts)
   ```
7. Если шаг 5 изменил файлы, закоммитьте их (`homelab: reapply patches`) и обновите метку:
   `pnpm exec tsx scripts/upgrade-state.ts set`.
8. Пересоберите образ агента: `./container/build.sh build`.
9. Перезапустите службу: `bash setup/lib/restart.sh`. Проверка: бот отвечает в двух темах,
   расход в Venice идёт на правильный ключ.
10. `git push origin homelab`.

Если upstream меняет контракт шлюза (`GatewayProviderDefinition`), упадут сборка или тест
`src/gateway-providers/homelab-iron-proxy.test.ts`. Исправьте
`.claude/skills/homelab-iron-proxy/payload/src/gateway-providers/homelab-iron-proxy.ts` по
`docs/gateway-seam.md`, затем скопируйте его в `src/gateway-providers/`.

## Известные ограничения

- Автоопределение шлюза ищет только навыки `add-*`. Поэтому `NANOCLAW_GATEWAY_PROVIDER=homelab-iron-proxy`
  в `.env` обязателен.
- Не запускайте `setup --step provider-auth opencode`: хранилище ключей этого шлюза отказывает.
  Модель задаётся только через `OPENCODE_*` в `.env`.
- Iron Proxy настроен с `require: false`. Запрос вне правил (другой хост или путь) уходит
  с заглушкой вместо ключа. Заглушка не секрет для внешнего сервиса, но её видно.
- Egress lockdown NanoClaw с этим шлюзом не работает: он принимает только `runtime`, а шлюз даёт `host`.
  Без lockdown агент может отправить запрос мимо прокси. Ключей у агента нет, поэтому ключи в безопасности.
  Allowlist экземпляра Iron Proxy ограничивает только трафик через прокси.
