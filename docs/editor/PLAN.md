# План микрофронтенда редактора схем

## Статус разведки

Фаза 0 выполнена чтением репозитория. Этот документ фиксирует исходное состояние и проектные решения до реализации. Перечисленные проверки сборки, браузера, производительности и внешнего вида здесь не считаются пройденными.

Корень рабочего дерева: `/home/neoplasmes/third_course_reimagined`. Последний исходный коммит: `64a2345`, `2025-07-17 07:36:52 +0300`. На момент начала разведки рабочее дерево содержит чужие изменения в `.gitignore`, `.moon/workspace.yml`, `.zed/settings.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` и удаление `.vscode/settings.json`. Их нельзя включать в коммиты редактора или отменять без проверки владельца.

Обязательные источники:

- `AGENTS.md`, `ARCHITECTURE.frontend.md`, `ARCHITECTURE.backend.md` в корне прочитаны.
- ADR 0001 находится в `artifacts/adr/0001-canvas-schema-editor-and-api.md`, а не в `docs/adr`. Каталог `artifacts` игнорируется Git. ADR описывает целевую архитектуру; API v2 в нём прямо отмечен как предложение.
- Дизайн: `/home/neoplasmes/third_course_reimagined/artifacts/schema-editor-design`. Прочитаны `AGENTS.md` целиком, `design-system/components/SchemaCard/README.md`, токены и HTML экранов 01 и 07. Пакет остаётся внешним источником, в репозиторий переносится только результат генерации токенов.
- Прочитаны профильные инструкции `.codex/agents/canvas-engineer.toml` и `.codex/agents/editor-verifier.toml`.

Подтверждённых условий остановки нет. ADR и дизайн согласованы в поведении. Хост уже использует обычный webpack 5 и не требует полной замены сборки. Единственный необходимый DOM-элемент внутри доски - временный input переименования, разрешённый обоими источниками.

## Что уже есть

| Область | Проверенный факт | Следствие |
|---|---|---|
| Пакетный менеджер | `packageManager: pnpm@10.13.1`, pnpm workspace и lock-файл существуют | Миграция с npm не нужна |
| Инструменты | `.prototools`: proto 0.48.1, moon 1.35.4, Node 22.15.0, pnpm 10.13.1, Python 3.12.10, uv 0.7.2 | Сохраняем текущий инструментарий; новые версии проверяет bloodhound |
| Moon | `.moon/workspace.yml` содержит root/client/server/documents-generator; `.moon/toolchain.yml` задаёт pnpm | Добавляем отдельный id `editor` |
| Хост | `apps/client`: React/ReactDOM 19.1.0, react-router 7.7.0, webpack 5.100.2, webpack-dev-server 5.2.2, TypeScript 5.8.3 | React остаётся в хосте, Pixi добавляется только remote |
| Сборка хоста | `webpack.config.js` уже ручной ESM-конфиг, ts-loader, style-loader/MiniCssExtractPlugin, css-loader, sass-loader | Module Federation подключается добавлением плагина и асинхронного bootstrap |
| Dev-хост | Порт 3000, HMR, historyApiFallback, publicPath `/` | Новый маршрут может открываться напрямую |
| Проверки хоста | Уже Vitest 3.2.4, ESLint 9, strict TypeScript | Jest в текущем состоянии нет |
| Маршруты | `/` - WelcomePage, `/edit` - EditPage, общий WorkingSchemaContextProvider | Новую страницу подключаем на `/edit`, старую временно оставляем доступной отдельно |
| Стили хоста | Глобальный reset, body overflow hidden, Sansation из Google Fonts, `.App` с padding 4px 8px | Editor задаёт собственный корень, font и размеры; проверяем влияние host CSS |

Все новые зависимости и их транзитивное разрешение должны существовать не позднее `2025-10-19T09:24:48Z` и к обеим датам вводящего коммита. Верхняя граница не разрешает взять пакет августа в коммит июля. Bloodhound подтвердил enhanced federation 0.17.0 от 15 июля 2025 и PixiJS 8.11.0 от 3 июля 2025; окончательное разрешение и tsx проверяются отдельно. Существующие semver-диапазоны не являются доказательством историчности будущего resolve.

## Сервер и граница возможностей

Реально работающие маршруты текущего сервера:

1. `POST /schema/sessions`: multipart `files`, ответ 201 `{ message, session_id }`.
2. WebSocket `/schema/sessions/{session_id}/events`: подключение запускает обработку; progress содержит `processed`, `total`, `progress`; completed содержит `message` как строку JSON с editor-expression.
3. `POST /schema/xsd`: принимает целую выбранную схему и отдаёт XML-файл.

В finally WebSocket и процесса сессия очищается. Нет GET для повторной загрузки результата, постоянного projectId, schemaId, revision, снимков, страниц, changesets, предпросмотров и серверного сохранения позиций. Нельзя выдавать `session_id` за долгоживущий идентификатор проекта, восстанавливать сессию после очистки или называть локальное изменение сохранённым на сервере.

`apps/server/sample.json` - словарь по строковым ключам вида `begin-c/root-c` и `parent/child`, со свойствами `expression`, `typoSpace`, `semanticSpace`, `attributes`, `XSDTypes`. Expression рекурсивен и использует LEAF/AND/OR с вероятностью и min/maxOccurs. `expression.json` - другой демонстрационный формат `{ name, children }`; это не manifest нового API и не контракт сохранения.

Текущий writer `apps/server/src/env/tools/schema_expression/schema_expression_writer_tool.py` выдаёт прежний формат для клиента и теряет часть возможностей целевой модели. Исходный `sample.json` отличается от новых результатов: writer уже может вкладывать полные строковые ключи в LEAF. Прямое повторное использование старого алгоритма восстановления дерева поэтому требует отдельной проверки.

Для этой задачи доступны независимые направления:

- Реальный remote владеет загрузкой через `apiBaseUrl`, работает через типизированные repo-порты, показывает честную ошибку неподдержанного API.
- Standalone и визуальные сцены работают с явно обозначенным fixture adapter, воспроизводящим ограниченные страницы и все состояния. Интеграционный маршрут хоста для этой проверки также прямо обозначается demo/fixture, без имитации сохранённого реального ресурса. Fixture не доказывает наличие API v2 на сервере.
- Реализация долговременного API v2 и замена всего процесса загрузки коллекций являются отдельным backend-объёмом. Если ведущий агент включает этот объём, это должно быть явно отражено в STATUS и проверках. Иначе недостающие серверные функции остаются явно обозначенным ограничением, а не неявной эмуляцией production.

## Контракт микрофронтенда

Предлагаемый контракт следует идентичности ADR вместо отсутствующего projectId:

```ts
export type EditorResource =
  | { kind: 'schema'; schemaId: string; revision?: string }
  | {
      kind: 'analysis';
      analysisId: string;
      revision: string;
      rootAlternativeId?: string;
    };

export type EditorProps = {
  resource: EditorResource;
  apiBaseUrl: string;
  onExit?: () => void;
  onSaved?: (result: {
    schemaId: string;
    revision: string;
    savedAt: string;
  }) => void;
};

export default function Editor(props: EditorProps): React.JSX.Element;
```

`schema` открывает ресурс схемы и точную либо текущую ревизию. `analysis` адресует неизменяемый снимок анализа, после чтения manifest создаёт независимый черновик через `POST /api/v2/schemas`; не меняет исходный анализ. Callback `onSaved` допустим только после подтверждённого changeset, не после изменения React state. `savedAt` является временем подтверждения сохранения, если сервер не возвращает своё время.

Экспорты federation: только `./Editor` и `./mount`. `mount(el, props)` создаёт собственный React root и возвращает `update(props)`/`unmount()`. Его жизненный цикл изолирован на экземпляр; замена `resource` отменяет старые чтения и не смешивает документы.

Для standalone fixture выбирается через собственный URL/entrypoint или composition root, не через передачу хостом BoardModel или внутренних объектов документа. Production-контракт не открывает внутренние адаптеры, React context, транспорт и renderer.

Хост использует React.lazy, Suspense и error boundary с английскими `Editor could not load` и `Try again`. Повтор создаёт новый lazy loader, чтобы rejected Promise не кешировался навсегда. React и react-dom shared singleton, requiredVersion берётся из package.json обоих приложений; react-router remote не использует и не разделяет. Pixi не shared. В обоих приложениях одна версия `@module-federation/enhanced`; fallback на встроенный плагин допустим только с документированной причиной.

Dev-адрес берётся из переменной окружения хоста. Production читает runtime-конфигурацию хоста, содержащую URL `mf-manifest.json` редактора, затем загружает remote по этому manifest. URL не должен быть константой в host bundle. Два manifest имеют разные роли: маленькая runtime-конфигурация хоста указывает размещение remote, federation manifest описывает его chunks и expose. Генерация и потребление dts входят в сборку.

## Модули и архитектурные границы

Структура приведена к именам и направлениям зависимостей `ARCHITECTURE.frontend.md`. Доска сохраняет собственную папку `board` как независимый модуль UI:

```text
src/
  index.ts
  bootstrap.tsx
  expose/editor/ expose/mount/
  main/dependencies/ main/editor/
  core/entities/schema/ core/processes/document_edit/
  app/contracts/
  app/editor/document/
  app/commands/ app/queries/ app/ports/repos/schema/
  env/transport/http/
  env/repos/schema/http/ env/repos/schema/fixture/
  env/cache/schema_pages/
  ui/di/
  ui/pages/editor/{model,lib,ui}/
  ui/widgets/editor_shell/{model,lib,ui}/
  board/{model,layout,render,text,interaction,viewport,theme,schema_board}/
  shared/ui/theme/
  standalone/
```

Пакеты имеют `index.ts`, внешние потребители импортируют публичный вход пакета. Корни слоёв `core`, `env`, `shared`, `app` и `main` не содержат `index.ts`. Pixi и браузерные события принадлежат board; React-контроллеры и проекция документа в BoardModel находятся в UI. Core и app независимы от React/Pixi/DOM, кроме AbortSignal для чтений. Main создаёт зависимости и передаёт UI готовые операции. Документ-реплика хранит историю и синхронизацию по исключению раздела 6.1 архитектуры; чистые правила редактирования находятся в core. Направления импортов и публичные входы проверяются в lint.

Четыре состояния ADR сохраняются раздельно: evidence - неизменяемые наблюдения; draft - семантический документ; bindings - происхождение; view - камера, экземпляры карточек, окна строк, выделение. Перемещение карточки не создаёт семантическую правку. Перенос поля создаёт одну операцию moveMember после завершения жеста. XML порядок задаётся членами sequence, не координатами карточек.

## Черновик BoardModel

Это модель представления загруженного фрагмента, без сетевых href и рекурсивного полного документа:

```ts
type Point = Readonly<{ x: number; y: number }>;
type BoardSelection = Readonly<{
  blockId: string;
  memberId: string | null;
}>;
type CollectionState =
  | 'notRequested' | 'loading' | 'partial' | 'complete' | 'failed';
type BoardRow = Readonly<{
  memberId: string;
  name: string;
  typeLabel: string;
  occurrenceLabel?: string;
  icon: 'element' | 'attribute' | 'group' | 'reference' | 'scalar';
  change: 'unchanged' | 'added' | 'removed';
  expandable: boolean;
  expanded: boolean;
  variantsCount?: number;
  observation?: { count: number; total: number };
}>;
type BoardCard = Readonly<{
  blockId: string;
  nodeId: string;
  collectionId: string | null;
  title: string;
  subtitle?: string;
  position?: Point;
  pinned: boolean;
  collapsed: boolean;
  suggested: boolean;
  rows: readonly BoardRow[];
  rowWindow: {
    firstMemberId: string | null;
    totalItems: number;
    state: CollectionState;
    hasMore: boolean;
  };
  variants?: readonly {
    variantId: string;
    scopeId: string;
    title: string;
    count: number;
    total: number;
  }[];
  activeVariantId?: string;
}>;
type BoardConnection = Readonly<{
  id: string;
  sourceBlockId: string;
  sourceMemberId: string;
  targetBlockId: string;
  kind: 'containment' | 'reference' | 'preview';
  state: 'normal' | 'selected' | 'unloaded';
}>;
type BoardModel = Readonly<{
  version: number;
  cards: readonly BoardCard[];
  connections: readonly BoardConnection[];
  selection: BoardSelection | null;
  state: 'ready' | 'loading' | 'empty' | 'failed';
}>;
```

Строковые ID непрозрачны: `blockId` адресует визуальный экземпляр, `nodeId` - семантический узел, `memberId` - конкретное употребление/члена. Один nodeId может отображаться в нескольких карточках. Скрытый sourceMemberId сохраняет связь с настоящим полем; renderer показывает индикатор у границы окна, а не привязывает линию к соседней строке. Summary и полная сущность различаются.

BoardModel не содержит hover: это локальное состояние указателя renderer. Selection можно обновлять извне для navigator sync. Состояние `removed` влияет на текст, но само по себе не подтверждает удаление документа. Partial отличается от empty: пустоту подтверждает только complete с totalItems 0.

## События и внутренний интерфейс доски

```ts
type BoardEventMap = {
  select: BoardSelection | null;
  hover: BoardSelection | null;
  rename: { blockId: string; memberId: string; name: string };
  move:
    | { kind: 'card'; blockId: string; position: Point }
    | {
        kind: 'member';
        memberId: string;
        sourceBlockId: string;
        targetBlockId: string;
        targetCollectionId: string;
        beforeMemberId: string | null;
      };
  expand: { blockId: string; memberId: string; expanded: boolean };
  variantChange: {
    blockId: string;
    variantId: string;
    scopeId: string;
  };
  viewportChange: { x: number; y: number; zoom: number };
};
```

`on<K extends keyof BoardEventMap>(event, handler)` возвращает unsubscribe. Create-функция сразу возвращает объект с `ready: Promise<void>` для async Pixi init, fonts.ready и безопасного destroy до завершения init. Публичные методы: setModel, on, viewport.fitAll/zoomTo/get/set, destroy. Повторный destroy безопасен.

До параллельной работы canvas-подзадач фиксируется `board/render/contracts/renderer.types.ts`:

```ts
type Rectangle = Readonly<{ x: number; y: number; width: number; height: number }>;
type BoardViewport = Readonly<{ x: number; y: number; zoom: number }>;
type BoardHit =
  | { kind: 'header'; blockId: string }
  | { kind: 'row'; blockId: string; memberId: string }
  | { kind: 'expand'; blockId: string; memberId: string }
  | { kind: 'variant'; blockId: string; variantId: string; scopeId: string }
  | { kind: 'boundary'; blockId: string; memberId: string }
  | { kind: 'more'; blockId: string; collectionId: string };
type BoardHitRegion = Readonly<{ bounds: Rectangle; target: BoardHit }>;
type BoardCardGeometry = Readonly<{
  blockId: string;
  bounds: Rectangle;
  header: Rectangle;
  rows: readonly Readonly<{ memberId: string; bounds: Rectangle }>[];
  regions: readonly BoardHitRegion[];
}>;
type BoardGeometry = Readonly<{
  version: number;
  cards: readonly BoardCardGeometry[];
}>;
type BoardRenderer = {
  setModel(model: BoardModel): void;
  setHover(selection: BoardSelection | null): void;
  setViewport(viewport: BoardViewport): void;
  getGeometry(): BoardGeometry;
  invalidate(): void;
  destroy(): void;
};
```

Все bounds в world coordinates. Hit-testing сначала делает query по spatial index, затем переводит screen point через viewport в world point и проверяет regions/строку. Geometry после model/layout change неизменяема до следующего обновления. Для drag preview renderer может добавлять отдельный метод геометрического смещения после согласования canvas-владельцем; он не меняет семантику документа. Interaction не строит альтернативную раскладку и не знает React. Hover обновляет только прежнюю и новую строку и смежные разделители, без пересоздания Text или всей карточки.

variantChange - намерение просмотра наблюдаемого варианта. Оно не создаёт union и не заменяет ручную структуру. Применение варианта после preview/confirmation контролирует document/controller. Множественный выбор в ADR не требуется, в первой версии выбор одиночный.

## Раскладка, графика и память

- Собственная детерминированная раскладка дерева слева направо; reference-рёбра не участвуют в рекурсивном обходе вложенности. Циклическая ссылка показывается ограниченно. Ручные pinned позиции сохраняются. Раскрытие меняет затронутый фрагмент; arrange явно перестраивает доступный фрагмент.
- Геометрия header 34px, field 28px, padding card 4px, row horizontal 10px, icon 14px + gap 8px. Радиусы card 12 / row 8. Чистая функция separator visibility скрывает разделитель после last, рядом с hovered/selected строкой и заголовком по эталону.
- Экран 07 задаёт overview при zoom < 0.35, working при 0.35 <= zoom <= 1.2, detailed при zoom > 1.2. В overview остаются название/счётчик, мелкие поля не создаются. Самый дальний режим без текста допускается отдельным порогом после визуальной проверки и фиксации ADR 0002.
- Экранный background создаётся один раз на размер: базовая поверхность, три мягких пятна, зерно 5%. Camera не меняет его текстуру. На доске нет сетки и точек.
- Одна общая 9-slice shadow texture, без фильтра на карточку. TextStyle общие, измерение кешируется по text/style, повторная растеризация после остановки zoom с задержкой. Расчёт первой раскладки после document.fonts.ready.
- Spatial index ограничивает запрос видимых карточек и пересекающих экран связей; visible=false для всех загруженных карточек недостаточно. Сцена содержит экран плюс небольшой запас, offscreen graphics уничтожаются или уходят в ограниченный pool. Кеш страниц и кеш текстур имеют разные бюджеты.
- Graphics для связей - по слоям, перестройка только по geometry/state changes, adjacency index для движения карточки. Crossing edge виден даже при обеих offscreen конечных карточках.
- rAF объединяет изменения и не запускает непрерывную отрисовку неподвижной сцены. DPR ограничен 2. Камера и жест не публикуют полное дерево через React на pointermove.
- Zoom к курсору сохраняет мировую точку под указателем; pinch/ctrl-wheel, trackpad pan, pointer cancellation и keyboard focus тестируются отдельно. prefers-reduced-motion отключает анимацию fit/zoom.

## Оболочка и стили

Минимальная оболочка повторяет геометрию 01: toolbar inset 8px, height 52px; navigator left 8px, top 68px, bottom 8px, width 248px; inspector right 8px, top 68px, bottom 8px, width 320px. Вся графика карточек, чипов и переключателей внутри карточек остаётся Pixi. Доступное DOM-дерево находится в navigator, не поверх строк доски.

Компоненты shell используют CSS Modules; переменные объявлены только на `.schema-editor`. Сбросов `:root`, body, html, input, `*` на уровне документа нет. Правила root/descendants локальны. Host reset/шрифт компенсируются в editor root; скриншоты страницы хоста до/после проверяют обратное влияние стилей.

Генератор `scripts/sync-tokens.ts` через tsx читает внешний tokens.json и создаёт только `board/theme/tokens.ts`, `shared/ui/theme/tokens.css`. Шапки указывают источник. В рукописном коде цветовых литералов нет. Token-тест различает чёрные alpha для label/fill/separator/edge и разрешённые нейтральные непрозрачные фоны `surface-canvas`/`canvas-shade`, белые surfaces, olive tokens и wine danger: сами исходные токены содержат непрозрачные серые фоны, их нельзя отклонить тестом, построенным без этого различия.

## Повторное использование старого клиента

| Модуль | Решение |
|---|---|
| TreeView и его SCSS | Не переносить: старые DOM-ноды/глобальные классы не соответствуют canvas и scoped shell |
| InspectNodeSidebar | Использовать как перечень старых свойств, новый минимальный inspector написать на CSS Modules |
| WorkingSchemaContext | Оставить legacy-странице; новый editor сам владеет document и зависимостями |
| treeModel/VirtualSchemaModel | Не переносить в новую модель: numeric IDs, children whole-tree и подписки на mutable class не покрывают snapshot/member identity |
| selectMostProbableSubtrees | Не переносить: независимый выбор типов/атрибутов и OR нельзя считать новым correlated evidence seed |
| createGlobalExpressionFromSchemaData | При необходимости ограничить legacy-adapter; не использовать для v2 или layout |
| sample.json | Исторический пример, не источник новых стабильных IDs и не production backend |

Старая EditPage сохраняется до проверки federation и полного доступного сценария. После подключения она явно помечается deprecated/TODO, новый маршрут не импортирует её внутренний controller. Миграция не означает удаления старого upload/XSD пути.

## Фазы и ownership

1. Ведущий агент: domain/application решения, composition/integration, сборка хоста, commits и итоговая оценка. Bloodhound: официальные даты релизов и совместимость API выбранных исторических версий.
2. Платформа: workspace registration, editor package/tasks, webpack/federation обоих приложений, dts, tokens script, test/lint setup, standalone entry. Только её агент меняет package/lock/config одновременно.
3. Canvas-engineer: board model/render/types, layout, viewport, render, text, interaction, imperative lifecycle. Внутренние задачи можно делить после фиксации types.ts с непересекающимся ownership.
4. Оболочка: shell, app как presentation adapter, projection и navigator sync. Не меняет renderer и не помещает React в application.
5. Ведущий агент: core/app/env и fixture/real adapter boundaries, semantic operations/history и интеграция без переноса старых mutable моделей.
6. Editor-verifier: playground fixtures, visual runner, browser assertions и evidence, VISUAL_REVIEW. Не исправляет production renderer без передачи ownership.
7. Профилирование после готовности жестов: stress и ещё две ADR-нагрузки, PERF. На SwiftShader нельзя подтверждать целевые 60 FPS среднего аппаратного GPU.

## Проверка готовности

- Все editor moon tasks: dev/build/typecheck/test/lint/playground/visual, совместный запуск host+remote; client build и browser startup.
- Standalone, federation host, unavailable remote и повтор, один runtime React, public exposes/dts, runtime manifest без зашитого production remote URL.
- Unit tests: deterministic/no-overlap layout, diff моделей, hit-test при нескольких zoom, cursor anchored zoom, separator rules, LOD boundaries, typed events. Дополнительно partial/complete/error и late-response guards проверяются на fixture-портах.
- Browser input: card drag, member transfer, keyboard navigation, Enter/Escape rename, pan/zoom, pinned/local layout, mount/unmount/resource switch, выбранная строка и navigator синхронны.
- Visual scenes: main(01), variants(02), replace-preview(03), card-anatomy(05), loading(06), lod(07), builder(11), stress. HTTP, DPR2, matching reference viewport; actual + side-by-side compare с crop координатами, записанными в runner.
- Каждое сравнение открывается человеком/агентом визуально, затем расхождения записываются в VISUAL_REVIEW с исправлением или допустимой причиной. Производный baseline не утверждает себя сам.
- Host editor screenshot сравнивается с 01. Отдельная host page до/после подтверждает отсутствие утечек CSS.
- PERF фиксирует median/p95 frame intervals, JS memory при доступности, viewport, DPR, browser build, CPU/GPU/backend, плотность строк и видимые объекты. Software WebGL явно помечается, отсутствующее аппаратное измерение не называется пройденным.
- ADR 0002 и README описывают фактический контракт, слои, адрес remote, текст, раскладку, LOD, бюджеты и input exception. STATUS перечисляет подтверждённое и отсутствующее, команды запуска и следующие шаги.

## Открытые вопросы и риски

1. API v2 отсутствует. Главный риск - незаметно заменить production-работу редактора демонстрационными данными. Fixture и real adapter должны различаться явно; поддержка старого upload без передачи целого состояния через props потребует отдельного переходного ресурса/адаптера.
2. Указанный в prompt projectId отсутствует в текущем сервере и ADR. Решение - schema/analysis resource в MF контракте; его окончательную форму ведущий агент фиксирует до реализации expose.
3. Хостовые body/reset/font/global classes могут влиять на remote даже при scoped CSS самого редактора. Нужна browser проверка размеров и наследования.
4. Enhanced federation dts и runtime manifest должны подтвердить совместимость с исторической версией. Не подключать текущую документацию к старому пакету без bloodhound.
5. Доступное дерево обязательно, но Pixi accessibility plugin с DOM-overlay на каждой строке нарушил бы правило доски. Accessibility обеспечивается shell navigator и собственным keyboard handling canvas.
6. Дизайн 07 использует иллюстративно увеличенную геометрию detailed-карточки; точную смену presentation metrics проверяет visual loop. Поведенческий смысл LOD остаётся ADR.
7. Большие связи могут пересекать viewport при offscreen endpoints. Простое card culling потеряет их. Нужен индекс геометрии рёбер и отдельный visible edge query.
8. Измерение 60 FPS через SwiftShader подтверждает только конкретную программную среду. Если нет доступа к среднему ноутбуку с GPU, PERF честно оставляет аппаратный критерий непроверенным.
9. Несколько агентов не должны одновременно менять lockfile, BoardModel/render types или document operations. Общие контракты фиксируются до параллельной реализации.

Никакое из этих ограничений не разрешает тихо нарушить ADR. Подтверждённый поведенческий конфликт с дизайном, необходимость полной переписи host build, дополнительный DOM внутри доски или дорого необратимое решение требуют остановки по пользовательскому правилу.
