# Docker Compose

Файлы лежат в `env/local`. Все задачи ждут healthcheck'ов (`--wait`, 120 секунд), используют mutex `workspace-compose` и не кешируются.

| Команда | Что поднимает |
|---|---|
| `moon run env:compose-up-database` | PostgreSQL и pgbouncer, `127.0.0.1:6432` |
| `moon run env:compose-up-server` | База и backend, `127.0.0.1:8000`. Собирает `server:image`. |
| `moon run env:compose-up` | База, backend и клиент с редактором, `127.0.0.1:3000`. Собирает все образы. |
| `moon run env:compose-down-database` | Останавливает базу. |
| `moon run env:compose-down-server` | Останавливает базу и backend. |
| `moon run env:compose-down` | Останавливает всё и удаляет осиротевшие контейнеры. |

Compose и k3d можно держать одновременно: compose использует порты 3000, 6432 и 8000, кластер использует 8080. Деплой в кластер описан в [local-deploy.md](local-deploy.md).
