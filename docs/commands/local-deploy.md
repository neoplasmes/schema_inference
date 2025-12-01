# Локальный деплой в k3d

Локальный Kubernetes-кластер `schema-workspace` на k3d с приложением и стеком мониторинга. Все команды запускаются из корня репозитория.

## Требования

- Docker.
- Инструменты из `.prototools`: k3d, kubectl, helm, helmfile, k9s. Ставятся вместе с остальными через `moon run root:setup` или отдельно через `proto install`.

## Команды moon

| Команда | Что делает |
|---|---|
| `moon run env:cluster-up` | Создаёт кластер по `env/k8s/k3d.config.yaml`: 1 server + 1 agent, без Traefik, порт `127.0.0.1:8080` → `80` балансировщика. Переключает текущий контекст kubectl на `k3d-schema-workspace`. |
| `moon run env:deploy-monitoring` | `helmfile sync` по `env/k8s/helmfile.yaml` (kube-prometheus-stack, Loki, Alloy в namespace `monitoring`) и применение дашбордов из `env/k8s/monitoring/dashboards`. |
| `moon run env:deploy` | Полный деплой приложения. Собирает образы `server`, `client`, `editor`, `gateway`, генерирует Caddyfile из OpenAPI, выполняет `deploy-monitoring`, импортирует образы в кластер (`k3d image import`), применяет `env/k8s/app` через kustomize, перезапускает deployment'ы и ждёт их готовности. |
| `moon run env:cluster-down` | Удаляет кластер вместе со всеми данными (база, загрузки, метрики, логи). |
| `moon run env:build-cache-config` | Перегенерирует `env/k8s/app/gateway/Caddyfile` из `env/cache/Caddyfile.template` и `apps/server/openapi.yaml`. Вызывается из `deploy` автоматически. |
| `moon run env:image-gateway` | Собирает образ шлюза `schema-workspace-gateway:development`. |
| `moon run env:lint` | Проверяет compose-файлы, рендер kustomize для приложения и дашбордов и актуальность Caddyfile. Кластер не нужен. |
| `moon run root:test-e2e-bruno-cluster` | Деплоит приложение и прогоняет коллекцию Bruno через шлюз (`http://localhost:8080`). |

Задачи кластера используют общий mutex `workspace-cluster` и не кешируются.

## Типовой сценарий

```bash
moon run env:cluster-up
moon run env:deploy
```

После изменения кода, манифестов или `Caddyfile.template` достаточно повторить `moon run env:deploy`. Изменение Caddyfile меняет хеш ConfigMap `gateway-<hash>`, и шлюз перезапускается rolling update без простоя.

Остановка:

```bash
moon run env:cluster-down
```

Если кластер нужно временно остановить без потери данных, используется k3d напрямую:

```bash
k3d cluster stop schema-workspace
k3d cluster start schema-workspace
```

## Адреса

| Адрес | Что там |
|---|---|
| http://localhost:8080 | Приложение через шлюз Caddy |
| http://localhost:8080/api/ | Backend API |
| http://localhost:8080/editor/ | Microfrontend редактора |
| http://localhost:8080/collect | Приём браузерной телеметрии Faro → Alloy |
| http://grafana.localhost:8080 | Grafana, логин `admin`, пароль `admin` |

## Что развёрнуто

Namespace `schema-workspace`:

| Компонент | Ресурсы |
|---|---|
| gateway | Caddy, 2 реплики, Service `LoadBalancer`, кеш ответов API в Valkey, метрики на `:2019`, healthz на `:8081` |
| server | FastAPI, 1 реплика, PVC для загрузок, `/metrics` |
| client, editor | nginx со статикой, по 2 реплики, sidecar `nginx-prometheus-exporter` |
| cache | Valkey + `redis_exporter` |
| database | PostgreSQL (StatefulSet) и pgbouncer |

Шлюз находит поды через headless Services (`*-pods`) и сам перечитывает DNS каждые 5 секунд, поэтому масштабирование подхватывается без перезапуска.

Namespace `monitoring`:

| Компонент | Назначение |
|---|---|
| Prometheus + Operator | Сбор метрик через ServiceMonitor'ы, хранение 3 дня |
| Grafana | Дашборды, источники Prometheus и Loki |
| Loki | Хранение логов, 72 часа |
| Alloy | Сбор логов всех подов в Loki, приём Faro на порту 12347 |
| kube-state-metrics, node-exporter | Метрики кластера и узлов |

## Мониторинг

- Дашборд **Schema workspace** в Grafana: RPS, задержки и доля 5xx backend'а, запросы шлюза и nginx по подам, кеш, браузерные ошибки и Web Vitals, логи.
- Стандартные дашборды kube-prometheus-stack: CPU, память и сеть подов и узлов.
- Логи в Grafana → Explore → Loki, например:

```logql
{namespace="schema-workspace", app="server"}
{namespace="schema-workspace", app="gateway"} | json | status >= 500
{job="faro"}
```

- Цели Prometheus: Grafana → Explore → Prometheus, запрос `up{namespace="schema-workspace"}`.

## k9s

```bash
k9s --context k3d-schema-workspace
```

| Клавиши | Действие |
|---|---|
| `:pods`, `:deploy`, `:svc`, `:cm` | Переключение типа ресурса |
| `0` / `1`… | Все namespace / выбранный |
| `l` | Логи выбранного пода |
| `s` | Shell в контейнер |
| `d` | describe |
| `ctrl-d` | Удаление ресурса |
| `shift-f` | Port-forward |
| `?` | Справка |

## Полезные команды kubectl

```bash
kubectl -n schema-workspace get pods
kubectl -n schema-workspace logs deploy/server -f
kubectl -n schema-workspace logs deploy/gateway -c caddy -f
kubectl -n schema-workspace scale deploy/client --replicas=4
kubectl -n schema-workspace rollout status deploy/gateway
kubectl -n schema-workspace rollout undo deploy/gateway
kubectl -n monitoring port-forward svc/kube-prometheus-stack-prometheus 9090
```

## Частые проблемы

- **server перезапускается при первом деплое.** PostgreSQL ещё поднимается, после нескольких рестартов под становится Ready.
- **`rollout status` падает по таймауту после правки Caddyfile.** Новый под шлюза не стартует, старые продолжают обслуживать трафик. Причина в `kubectl -n schema-workspace logs deploy/gateway -c caddy`, откат через `rollout undo`.
- **Порт 8080 занят.** Кластер не создастся, пока порт держит другой процесс, например `env:compose-up`.
- **grafana.localhost не открывается.** Браузеры резолвят `*.localhost` в 127.0.0.1 сами, curl требует `-H 'Host: grafana.localhost'` или `--resolve`.
