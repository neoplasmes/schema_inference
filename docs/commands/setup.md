# Установка и зависимости

| Команда | Что делает |
|---|---|
| `moon run root:setup` | `proto install` (Python, uv, Node, pnpm, k3d, kubectl, helm, helmfile, k9s), `pnpm install` и `uv sync` по lock-файлам. |
| `moon run server:setup` | `root:setup` и загрузка словарей NLTK для backend в `apps/server/nltk_data`. |
| `moon run server:setup-runtime` | Установка только runtime-зависимостей backend без dev-пакетов. Используется в Docker-образе. |
| `moon run client:setup` | `root:setup` и установка Chromium для Playwright. |
| `moon run root:lock` | Обновление обоих lock-файлов. |
| `moon run root:lock-backend` | `uv lock`. |
| `moon run root:lock-frontend` | `pnpm install --lockfile-only`. |

Версии инструментов закреплены в `.prototools`, автоустановка отключена, поэтому после изменения `.prototools` нужно повторить `root:setup` или `proto install`.
