# Локальная разработка

| Команда | Что делает |
|---|---|
| `moon run server:start` | Backend через `python -m main`. |
| `moon run server:start-e2e` | Backend с тестовым окружением из `tests/support`. |
| `moon run client:dev` | Клиент и редактор вместе через `scripts/dev.ts`. |
| `moon run client:dev-web` | Только webpack dev server клиента. |
| `moon run client:start-e2e` | Сервер для e2e-тестов клиента. |
| `moon run editor:dev` | Webpack dev server редактора в standalone-режиме. |
| `moon run editor:build-tokens` | Синхронизация CSS-токенов дизайна. |

Базу для `server:start` можно поднять через `moon run env:compose-up-database`, см. [compose.md](compose.md).
