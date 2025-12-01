# Сборка, образы и генерация

## Сборка

| Команда | Результат |
|---|---|
| `moon run server:build` | Python-пакет в `apps/server/dist`. |
| `moon run client:build` | Production-сборка клиента в `apps/client/dist`. Перед ней `client:build-types`. |
| `moon run client:build-types` | Собирает редактор и забирает его Module Federation типы в `apps/client/@mf-types`. |
| `moon run editor:build` | Production-сборка редактора в `apps/editor/dist`. |

## Docker-образы

| Команда | Образ |
|---|---|
| `moon run server:image` | `schema-workspace-api:development` |
| `moon run client:image` | `schema-workspace-client:development` |
| `moon run editor:image` | `schema-workspace-editor:development` |
| `moon run env:image-gateway` | `schema-workspace-gateway:development` |

Образы используются и compose, и k3d. Реестр не нужен: в кластер они импортируются через `k3d image import`.

## Генерация

| Команда | Результат |
|---|---|
| `moon run server:build-openapi` | `apps/server/openapi.yaml` из кода FastAPI. |
| `moon run env:build-cache-config` | `env/k8s/app/gateway/Caddyfile` с правилами кеша по OpenAPI. |
| `moon run root:build` | 100 тестовых документов в `tools/documents-generator/generated` (seed 42). |
| `moon run editor:build-tokens` | CSS-токены дизайна редактора. |
