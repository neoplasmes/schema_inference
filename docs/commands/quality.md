# Линтеры, форматирование и типы

Задачи есть у проектов `root`, `server`, `client`, `editor`, `entity-cache`, `env`. Без указания проекта (`moon run :lint`) задача выполняется во всех проектах, где она есть.

| Команда | Что делает |
|---|---|
| `moon run :lint` | Все линтеры. |
| `moon run :typecheck` | Все проверки типов. |
| `moon run :fmt` | Форматирование, перед ним `lint-fix`. |
| `moon run :check` | `fmt`, `lint-fix` и `typecheck` вместе, для локального использования. |
| `moon ci` | Все задачи, затронутые изменениями, как в CI. |

## По проектам

| Проект | lint | Особенности |
|---|---|---|
| `server` | ruff и проверка, что `apps/server/openapi.yaml` совпадает с кодом | typecheck: pyright |
| `client` | ESLint и `lint-architecture` | typecheck требует `client:build-types` |
| `editor` | ESLint и `lint-architecture` | |
| `entity-cache` | ESLint | |
| `root` | ruff для `tools/` и `lint-bruno`: покрытие OpenAPI коллекцией Bruno | typecheck: pyright для генератора документов |
| `env` | compose, kustomize, дашборды, актуальность Caddyfile | `lint-python` и `fmt` для `env/docker` и `env/cache` |

`lint-architecture` в клиенте и редакторе проверяет зависимости между слоями `core`, `app`, `env`, `ui`, `main`, `shared`.
