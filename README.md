# XML schema workspace

Монорепозиторий редактора вероятностного пространства XML-схем: React-клиент в `apps/client` и Python API в `apps/server`.

Инструменты закреплены в `.prototools` по состоянию на 1 мая 2025 года включительно. Для Node.js выбрана ветка LTS 22, для Python — 3.12.

| Инструмент | Версия | Дата публикации |
| --- | --- | --- |
| proto | [0.48.1](https://github.com/moonrepo/proto/releases/tag/v0.48.1) | 30.04.2025 |
| moon | [1.35.4](https://github.com/moonrepo/moon/releases/tag/v1.35.4) | 01.05.2025 |
| Python | [3.12.10](https://www.python.org/downloads/release/python-31210/) | 08.04.2025 |
| uv | [0.7.2](https://github.com/astral-sh/uv/releases/tag/0.7.2) | 30.04.2025 |
| Node.js | [22.15.0 LTS](https://nodejs.org/en/blog/release/v22.15.0) | 23.04.2025 |
| npm | [11.3.0](https://github.com/npm/cli/releases/tag/v11.3.0) | 08.04.2025 |

Установка инструментов из корня репозитория:

```bash
export PROTO_HOME="$PWD/.proto"
proto install proto 0.48.1
"$PROTO_HOME/tools/proto/0.48.1/proto" use
eval "$("$PROTO_HOME/tools/proto/0.48.1/proto" activate bash --export)"
```

Каталог `.proto` изолирует исторические инструменты и их метаданные от современных глобальных установок. Выполняйте настройку из корня репозитория; в новом терминале повторите `export PROTO_HOME="$PWD/.proto"` и команду активации. Если proto ошибочно сообщает об отсутствии сети при рабочем подключении, повторите установку с `PROTO_OFFLINE=false`.

Команды из корня репозитория:

```bash
moon run server:dev
moon run client:dev
```

В `main.py` создаётся `Settings` с явными путями из `UPLOAD_ROOT` и `WORDNET_ROOT`.
По умолчанию это `uploaded_files` и `nltk_data` относительно рабочего каталога
запуска. Задачи Moon запускают сервер из `apps/server`. Для контейнера или запуска
из другого каталога задавайте пути явно, например:

```bash
UPLOAD_ROOT=/data/uploads WORDNET_ROOT=/data/wordnet moon run server:start
```

В `WORDNET_ROOT` должен находиться каталог `corpora` с архивом `wordnet.zip`.

Moon устанавливает зависимости при первом запуске соответствующей задачи. Бэкенд и `packages/xml_data_generator` используют общий uv workspace: один `uv.lock` и одно окружение `.venv` в корне. Зависимости пакетов по-прежнему объявляются в их собственных `pyproject.toml`; `tool.uv.sources` связывает локальные пакеты без публикации в PyPI. Python устанавливает proto; загрузка другого интерпретатора через uv отключена. `UV_PYTHON` в `.prototools` должен совпадать с закреплённой версией Python.

Дата разрешения Python-зависимостей ограничена через `tool.uv.exclude-newer` в корневом `pyproject.toml`; npm использует аналогичное ограничение `before` в `apps/client/.npmrc`. При разрешении зависимостей выбираются публикации не позднее `2025-05-01T23:59:59Z`. Созданный uv lockfile следует сохранять в репозитории.

Версии плагинов закреплены в `.prototools`. Локальный TOML-плагин `.moon/plugins/python.toml` устанавливает Python 3.12.10 из [сборки python-build-standalone от 9 апреля 2025 года](https://github.com/astral-sh/python-build-standalone/releases/tag/20250409) и использует соответствующий файл SHA-256. Адреса не зависят от обновляемого реестра сборок. Плагин рассчитан на Linux/WSL и macOS (x64/ARM64), а также Windows (x86/x64); наличие архива зависит от платформы и libc. При обновлении Python нужно согласованно изменить версию, дату сборки и список `resolve.versions` в плагине.

moon 1.35.4 запускает shims через собственный proto 0.47.11, поэтому Node-плагин закреплён на совместимой версии 0.16.1. Для Python в `.moon/toolchain.yml` указан WASM-плагин 0.14.1: эта версия moon не читает TOML-плагины. Сначала выполняйте `proto use`, чтобы moon использовал уже установленную историческую сборку Python.

Архитектурный контракт бэкенда находится в [ARCHITECTURE.md](ARCHITECTURE.md).

## Алгоритм без запуска API

```bash
uv sync --all-packages --locked
moon run server:download-wordnet
uv run xml-data-generator --output artifacts/generated --scenario all --documents 8 --seed 42
moon run server:evaluate
```

WordNet устанавливается отдельной командой из закреплённого архива с проверкой
SHA-256. Во время вывода схемы сетевых запросов нет. Отсутствие словаря отражается
в предупреждениях; для полной проверки нужен установленный архив.

`server:evaluate` сохраняет реальные входные XML, исходящий JSON и отчёты сравнения
в `artifacts/inference-review`. Для своего набора, созданного генератором:

```bash
PYTHONPATH=apps/server/tests uv run --no-sync python -m integration.evaluate --manifest artifacts/generated/manifest.json --output artifacts/generated-review
uv run --no-sync pytest
```

Новый результат `xml-probability-space` версии 1 сохраняет наблюдения и предлагает
соответствия с объяснениями и вариантом `keep_separate`. Эвристические оценки
не выдаются за вероятности. Существующий клиент требует отдельной адаптации
к этому формату.

Устройство алгоритма: [BUSINESS_LOGIC.md](apps/server/BUSINESS_LOGIC.md).
Генератор: [packages/xml_data_generator](packages/xml_data_generator/README.md).
Метрики, ручные случаи и команды: [оценка алгоритма](apps/server/tests/integration/README.md).
