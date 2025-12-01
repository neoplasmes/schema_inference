# Тесты

## Backend

| Команда | Что делает |
|---|---|
| `moon run server:test-unit` | pytest `tests/unit`. |
| `moon run server:test-int` | pytest `tests/integration`, не кешируется. |
| `moon run server:test-int-corpus` | Оценка вывода на корпусе документов, отчёт в `artifacts/inference-review`. Не запускается в CI. |
| `moon run server:test-e2e` | pytest `e2e` против собранного Docker-образа. |

## Frontend

| Команда | Что делает |
|---|---|
| `moon run client:test-unit`, `editor:test-unit`, `entity-cache:test-unit` | Vitest. |
| `moon run client:test-e2e-mock` | Playwright против собранного клиента с mock-данными. |
| `moon run client:test-e2e-api` | Playwright против настоящего backend в Docker. |
| `moon run client:test-e2e-container` | Playwright против образов client, editor и server. |
| `moon run client:test-e2e` | Все три режима последовательно. |
| `moon run editor:test-e2e-visual` | Скриншотные проверки доски редактора. |
| `moon run editor:test-e2e-performance` | Замеры производительности доски. |

Браузерные задачи клиента используют mutex `client-browser`, редактора — `editor-browser`.

## API через Bruno

| Команда | Что делает |
|---|---|
| `moon run root:test-e2e-bruno` | Поднимает backend в compose и прогоняет `docs/bruno` с окружением `local` (`http://localhost:8000`). |
| `moon run root:test-e2e-bruno-cluster` | Деплоит в k3d и прогоняет с окружением `cluster` (`http://localhost:8080`), включая проверки кеша шлюза. |
