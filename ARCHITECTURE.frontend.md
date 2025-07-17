# Frontend Architecture

## 0. In one paragraph

This is a clean (hexagonal) architecture with command/query separation, unified with our backend architecture. The domain lives in `core`, application operations live in `app` and depend only on `core` and on ports they declare themselves, implementation details live in `env`, the user-facing entrypoints live in `ui`, and everything is wired in `main`.

**The main rule:**

> Every read is a `Query`. Every write is a `Command`. Entity content lives in the `EntityStore`, the composition of reads lives in the query cache.

Everything below is a consequence of this rule.

---

## 1. Layers

| Layer  | Folder    | Owns                                                                   | Backend analogue    |
|--------|-----------|------------------------------------------------------------------------|---------------------|
| Main   | `main/`   | Composition root: creates instances, wires them, renders the app       | `main.py`           |
| View   | `ui/`     | Entrypoints of the application: pages, widgets, controllers            | `api/`              |
| App    | `app/`    | Commands, queries, ports                                               | `app/`              |
| Env    | `env/`    | Implementation details: transport, repos, cache, tools                 | `env/`              |
| Core   | `core/`   | Entities, entity refs, business processes                              | `core/`             |
| Shared | `shared/` | Project-agnostic code: design system, UI tools, plain utils, UI stores | `shared/`           |

`ui/` plays the same role as `api/` on the backend: it is the entrypoint through which the outer world (the user) drives the application. The API of a frontend is its UI.

### 1.1 Core

- **Entities** are plain data. Every entity carries its address: `ref: EntityRef`. Domain behaviour is written as pure functions next to the entity (`canPromote(user)`, `cartTotal(cart)`, `renameBoard(board, title)`), not as class methods. Plain data survives serialization (SSR), structural sharing and normalization; class instances do not.
- **`entity_ref.ts`** is the vocabulary of the whole data layer. An `EntityRef` is simultaneously the identity of an entity in the store and the unit of invalidation.
- **Processes** are business decisions spanning several entities. They only accept and return data.

```ts
// core/entities/entity_ref.ts
export type EntityName = 'user' | 'cart' | 'order' | 'session';
export type EntityRef = EntityName | `${EntityName}:${string}`;
//                      ^ collection  ^ concrete entity

// core/entities/entity.ts
export interface Entity {
  readonly ref: EntityRef;
}
```

### 1.2 App

- **Commands** (`app/commands/`) - one application write operation per folder.
- **Queries** (`app/queries/`) - one application read operation per folder, including trivial single-entity reads. A trivial query is five lines; that is the price of uniformity.
- **Ports** (`app/ports/`) - interfaces declared by `app` and implemented by `env`:
  - `ports/repos/` - full contracts of repositories;
  - `ports/tools/` - complex client algorithms with swappable implementations (`.gitkeep` until needed).

`app` does not know that a cache, a transport, React or a browser exist. The only platform type allowed here is `AbortSignal`.

### 1.3 Env

- **`env/transport/`** - how data travels: `HttpTransport`, `WebSocketTransport`, later `GraphqlTransport`. One class per file.
- **`env/repos/`** - how data is obtained and sent: network calls, response validation (zod), mapping DTO to entity. Every repo implements a port.
- **`env/cache/`** - the data layer for the UI: `EntityStore`, normalization, `useRead`, `useCommand`, invalidation, realtime sync, high-frequency streams.
- **`env/tools/`** - implementations of `app/ports/tools`.

Anything that sends or receives data over the network is a repo. A payment gateway, a token storage, a change feed, a connection status: all repos.

### 1.4 UI

- **Pages and widgets** follow the FSD-like slice layout: `ui/`, `model/`, `lib/` segments.
- **Controller** (`model/<name>.controller.ts`) links queries, commands, UI stores and presentation policy (for example, optimistic updates) for a component. Component + controller = logical component. A component may use several controllers.
- **`ui/di/`** declares the dependencies context and `useDependencies`. `main` only provides the value.

### 1.5 Shared

`shared/ui/design`, `shared/ui/tools`, `shared/lib`, `shared/model`. `shared` imports nothing from the project layers.

### 1.6 Main

Creates transports, repos, commands, queries, stores, the query client and the entity store; registers interceptors; wires session lifecycle; renders the app. **The only place that sees concrete repo classes.**

---

## 2. Dependency rules

```
                 ┌──────► app/commands ─┐
                 │        app/queries  ─┼──► app/ports ◄──── env/repos ──► env/transport
      ui ────────┤                      │                        ▲
                 │                      ▼                        │
                 └──────► env/cache ───────────────────────► (through ports)

      everyone ──► core          everyone ──► shared          main ──► everything
```

**Allowed**

```
ui   -> app, core, shared, env/cache
app  -> core, shared/lib
env  -> app, core, shared/lib
core -> shared/lib
main -> everything
```

**The only exception** to the inward direction:

```
ui -> env/cache        controllers use useRead, useCommand, EntityPatch
```

**Disallowed**

```
core -> app, env, ui, main, shared/ui
app  -> env, ui, main
env  -> ui, main
env/transport -> env/repos, env/cache, app, core
shared -> any project layer
anything except main -> main
anything except main -> env/repos        concrete repos are visible to main only
```

These rules are enforced by a linter (`eslint-plugin-boundaries` or `dependency-cruiser`), not by this document.

### 2.1 Framework boundaries

- **React**: `ui`, `shared/ui`, `main`, hooks in `env/cache`.
- **TanStack Query**: `env/cache` and `main` only. Controllers never import it; they use `useRead` and `useCommand`.
- **Zustand**: `shared/model`, `ui/**/model`, `env/cache`, `main`.
- **Browser APIs** (`window`, `location`, `localStorage`): not in `app` and `core`. If an operation needs such a value, `main` passes it through the constructor.

### 2.2 Ports

- **Repos: ports, always.** A port is the full contract of a repository and is shared by commands and queries. A repository has no public methods outside its port, except wiring methods called only by `main` (for example `attachInterceptors`).
- **Tools: ports, as on the backend.**
- **UI stores: no ports.** Their only consumer is a controller, which is already bound to React. There is nothing to protect.

A port is declared by its consumer, in `app`.

### 2.3 The transport boundary

`env/transport` knows **how** data travels, never **what** data it is. It contains protocol methods, the generic interceptor mechanism, retries at protocol level and serialization. It never contains the words "token", "user", "session" or a status code with business meaning.

Everything data-specific, including authorization, lives in repos. A repo that needs to affect every request registers an interceptor through the generic mechanism of the transport.

**Interceptors are registered only by the session repo** (and by a future telemetry repo, if any), **only from `main`, in a fixed order.** Interceptors are global side effects; their order must be visible in one place.

The transport does **not** deduplicate requests. TanStack Query already deduplicates reads by key, and transport-level deduplication conflicts with cancellation.

---

## 3. Contracts

### 3.1 Command

```ts
// app/commands/command.ts
export interface Command<I, O> {
  execute(input: I): Promise<O>;
  writes(input: I, output: O): EntityRef[];
}
```

- Exactly one input argument. `useMutation` passes one variable, and an input object is easier to extend.
- `writes` declares what the operation changed. It is a fact about the operation, not about a cache: the cache uses it for invalidation, realtime and audit can use it too.
- Commands are never cancelled. A write that reached the server may already be applied. Writes are made idempotent instead (idempotency key in the input).
- An expected business outcome is a result, not an exception (a declined payment is `{ kind: 'declined' }`).

### 3.2 Query

```ts
// app/queries/query.ts
export interface Query<I, O> {
  readonly name: string;
  execute(input: I, options?: ReadOptions): Promise<O>;
  reads(input: I): EntityRef[];
}

// app/ports/repos/read_options.ts
export type ReadOptions = { signal?: AbortSignal };
```

- `name` is the identity of the operation: logs, tracing, cache keys.
- `reads` declares which data the operation depends on. It lives next to `execute`, so whoever changes what the query reads sees what it declares.
- `options.signal` is passed down to ports. Reads are cancellable.

### 3.3 Ports and repos

```ts
// app/ports/repos/order.repo.ts
export interface OrderRepo {
  getById(id: string, options?: ReadOptions): Promise<Order>;        // read: takes ReadOptions
  listByUser(userId: string, options?: ReadOptions): Promise<Order[]>;
  createFromCart(input: CreateOrderInput): Promise<CreatedOrder>;      // write: does not
}

// env/repos/order/transport.order.repo.ts
class TransportOrderRepo implements OrderRepo {
  constructor(http: HttpTransport, ws: WebSocketTransport)   // only the transports it needs
  // each method: transport call -> zod schema -> mapper (sets `ref`) -> entity
}
```

- Read methods take `options?: ReadOptions` as the last argument, write methods do not.
- Errors a repo method may throw are declared next to the port: `order.repo.error.ts`.
- Mapping from the backend format to the domain format, including `ref`, is the repo's job.

### 3.4 Checks on the vocabulary

A CI script (ts-morph) collects every `EntityRef` literal from `reads` and `writes` and reports:

1. a ref appears in `reads` but no command `writes` it: such data never refreshes after writes (warning; read-only reference data goes to an explicit allowlist);
2. a ref appears in `writes` but no query `reads` it: an invalidation that invalidates nothing;
3. a name in `EntityName` is used nowhere;
4. `entity_ref.ts` contains anything except the union.

### 3.5 The litmus test

> If the cache disappeared tomorrow, would this method still make sense?

`reads`, `writes`, `name` pass: they describe operations. Optimistic predictions, freshness and query keys fail: they belong to `env/cache` or to the controller.

---

## 4. Data layer

### 4.1 Two storages, two mechanisms

| Storage                    | Holds                                                     |
|----------------------------|-----------------------------------------------------------|
| `EntityStore`              | **Content** of entities, one record per `EntityRef`       |
| Query cache (TanStack)     | **Composition** of reads: which refs a read returned, loading state, freshness |

| Something changed...       | Mechanism                                                  |
|----------------------------|------------------------------------------------------------|
| content of an entity       | upsert into `EntityStore`; every screen showing it updates |
| composition of a read      | invalidation of queries whose `reads` intersect the command's `writes` |

Normalization cannot know whether a new order belongs to "page 2 of paid orders", only the server can. That is why composition is invalidated, not patched.

**Ref conventions.** A read of a list reads the collection ref (`order`). A read of one entity reads the concrete ref (`order:17`). A command that creates or deletes writes the collection ref; a command that changes an entity writes its concrete ref, plus the collection ref if the change can move it in or out of filtered lists.

### 4.2 EntityStore

```ts
// env/cache/entity_store.ts
class EntityStore {
  get(ref: EntityRef): Entity | undefined
  upsert(ref: EntityRef, partial: Partial<Entity>): void
  remove(ref: EntityRef): void
  subscribe(ref: EntityRef, listener: () => void): Unsubscribe
  begin(): OptimisticLayer            // { apply(patches), discard() }
}
```

**Semantics:**

- **Merge, not replace.** Different reads return different shapes of the same entity. A field that is absent (`undefined`) was not delivered and keeps its old value; a field that is `null` was explicitly cleared. Nested entities are normalized into their own records; nested plain objects (value objects) are replaced as a whole.
- **Layers.** The store keeps a confirmed base and an ordered list of optimistic layers. A read sees the base with the layers applied. Server truth always goes to the base, so a realtime event that arrives while a command is in flight is not lost when the layer is discarded.
- **Garbage collection/clean jobs** An entity is retained while it is referenced by a cached read or by an optimistic layer. When the query cache drops a read, entities referenced by nothing else are removed. Actually this mechanism shouldn't be overcomplicated unless it needs to: the goal here is to eventually have no unrefed objects, but not to not have them even for a second - there are actually can be a cases, when cached data is unrefed for a couple of seconds, but then it is needed again; probably mark-and-sweep should be used;
- **Referential stability.** Denormalized objects are memoized by entity version. An unchanged entity yields the same object reference, otherwise memoized components re-render everywhere.

The store is implemented on top of a vanilla Zustand store and is covered by a test suite written before the store itself: merge rules, layers under concurrent events, reference stability, garbage collection. The contracts in `app` do not depend on the implementation: moving to TanStack DB after it stabilizes touches `env/cache` only.

### 4.3 Reads

```ts
// env/cache/query_options_for.ts
queryOptionsFor(query, input)
  // queryKey:  [query.name, input]
  // queryFn:   ({ signal }) -> query.execute(input, { signal }) -> normalize into EntityStore
  // meta.tags: query.reads(input)
  // staleTime: from freshness.ts

// env/cache/use_read.ts
useRead(query, input): { data, isPending, error }
  // useQuery(queryOptionsFor(...)) + denormalize with subscriptions to the refs in the result
```

The same `queryOptionsFor` is used by router loaders and SSR prefetch: `queryClient.ensureQueryData(queryOptionsFor(query, input))`.

**Freshness** is not a property of an operation, it is a policy of the cache. A global default is set in `main/query_client.ts`; overrides by query name live in `env/cache/freshness.ts`.

Cancellation path: `useRead` -> `queryFn({ signal })` -> `query.execute` -> port -> transport -> `fetch`. TanStack Query aborts only if `signal` is accessed in `queryFn`; `queryOptionsFor` always does.

### 4.4 Writes and optimistic UI

```ts
// env/cache/use_command.ts
export type EntityPatch =
  | { ref: EntityRef; patch: Partial<Entity> }
  | { ref: EntityRef; remove: true };

useCommand(command, options?: {
  optimistic?: (input, current: (ref: EntityRef) => Entity | undefined) => EntityPatch[];
}): { execute, isPending, error, data }
```

Lifecycle inside `useCommand`:

1. open an optimistic layer and apply `optimistic(input)`, if given;
2. on error: discard the layer;
3. on success: normalize the output into the base, discard the layer, invalidate queries whose `reads` intersect `writes(input, output)`.

**Optimistic behaviour is a presentation decision** and lives in the controller. The same command can be optimistic on one screen and not on another; payment is never optimistic. The computation of the expected state is domain logic and comes from `core`:

```ts
// ui/pages/board/model/board.controller.ts
const rename = useCommand(deps.renameBoard, {
  optimistic: (input, current) => [
    { ref: `board:${input.boardId}`, patch: renameBoard(current(`board:${input.boardId}`), input.title) },
  ],
});
```

If the same optimistic policy is needed on several screens, it is extracted next to the controllers, never back into the command.

### 4.5 Invalidation by hand

```ts
// env/cache/invalidator.ts
class CacheInvalidator {
  invalidate(refs: EntityRef[]): Promise<void>   // mark matching reads stale
  evict(refs: EntityRef[]): void                 // drop matching reads
  invalidateAll(): Promise<void>                 // realtime gap
  clearAll(): void                               // logout
}
```

Used for the cases outside the command lifecycle: logout, realtime, host events from embedded packages.

### 4.6 Typing

```ts
// env/cache/register.d.ts
import '@tanstack/react-query';
import type { EntityRef } from '@/core/entities';

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: { tags?: EntityRef[] };
  }
}
```

The file must contain imports, otherwise it becomes a global script and the augmentation silently does nothing.

---

## 5. Errors

| Kind                          | Declared in                                      | Thrown by        | Shown as                        |
|-------------------------------|--------------------------------------------------|------------------|---------------------------------|
| Technical: network, protocol  | `env/transport` (`NetworkError`, `HttpError`)    | transport        | error boundary or retry UI      |
| Contract violation (zod)      | `env/repos` (`ContractViolationError`)           | repo             | error boundary + logging; it is a bug |
| Repo-level domain error       | `app/ports/repos/<name>.repo.error.ts`           | repo (maps status/code) | decided by the controller |
| Operation error               | `app/commands/<name>/<name>.command.error.ts`, `app/queries/<name>/<name>.query.error.ts` | command or query | decided by the controller |
| Domain rule violation         | `core/processes/<name>/<name>.error.ts`          | process          | decided by the controller       |
| Expected business outcome     | not an error: a result variant                   | command          | normal UI state                 |

- A repo translates protocol errors with domain meaning (409 "email taken") into errors declared by its port. Everything else passes through as technical errors.
- Commands and queries either let errors pass or rethrow their own.
- The controller decides the presentation: inline, toast, error boundary. Nothing below `ui` knows how an error is shown.

---

## 6. Client state

### 6.1 Where state goes

Walk top to bottom, stop at the first "yes":

1. Does the server own it? -> `Query` + `EntityStore`.
2. Must it survive a reload or live in a link? -> Router (URL).
3. Is it a dependency rather than state? -> DI context.
4. Is it needed by one subtree only? -> `useState` and props (unless drilled too deep).
5. Otherwise -> a UI store (Zustand).

Two special cases:

- **High-frequency server data** (price ticks, coordinates, progress several times per second) does not go into the query cache or the `EntityStore`: every update would notify all subscribers. It goes through a stream class in `env/cache/streams/` into a dedicated store, batched per frame.
- **Replicas.** Data the client holds as its own replica and changes at input frequency (a collaborative board) lives neither in the cache nor behind `Command`. It lives in a document engine with its own operations, history and sync (see 10.4).

### 6.2 UI stores

A store lives as high as it is needed and never higher:

```
ui/widgets/orders_table/model/selection.store.ts    <- one widget
ui/pages/checkout/model/checkout.store.ts           <- several widgets of one page
shared/model/theme.store.ts                         <- the whole application
```

- A store never makes network requests, never contains business rules and never holds a copy of server data.
- Application-wide stores are created by factories (`createThemeStore()`) in `main` and exposed through DI, so SSR gets one instance per request. The reading hook (`useTheme(selector)`) lives in `ui`, because it reads DI.
- Always read with a selector; several fields at once need `useShallow`.
- **No ports for stores** (see 2.2).

---

## 7. Controllers and components

- A controller is a hook: `use<Name>Controller`. It is the only place where queries, commands, UI stores and presentation policy meet.
- Controllers call `useRead`, `useCommand`, store hooks and `useDependencies`. They never import TanStack Query, repos or transports.
- `useMemo` and `useCallback` optimize re-renders, which is a view concern: they belong to components. The exception is a handler the controller itself returns: memoize where the function is created.
- Both controllers and components are bound to React. If React is ever replaced, both are rewritten, and that is acceptable. We do not build abstractions against a UI framework change.

---

## 8. Naming

- Underscore joins a compound name, a dot separates logical parts, the implementation name goes first:

```
transport.order.repo.ts          class TransportOrderRepo implements OrderRepo
idb.drafts.repo.ts               class IdbDraftsRepo implements DraftsRepo
http.transport.ts                class HttpTransport
web_socket.transport.ts          class WebSocketTransport
checkout.command.ts              class Checkout implements Command<...>
checkout_preview.query.ts        class CheckoutPreview implements Query<...>
checkout.command.error.ts
order.repo.ts                    interface OrderRepo (port)
order.repo.error.ts
assert_checkoutable.process.ts
use_read.ts
```

- Every package exposes its public names through `index.ts`. Imports go to packages, never to implementation files.
- Every command, query and process has its own folder, even if it is one file.

---

## 9. Folder structure

```
src/
  main/
    dependencies.ts               <- transports, repos, commands, queries, stores, wiring
    query_client.ts
    main.tsx
  core/
    entities/
      entity.ts
      entity_ref.ts
      <name>/
        <name>.entity.ts          <- type + pure functions
        <name>.events.ts          <- realtime event types, if any
        index.ts
      index.ts
    processes/
      <name>/
        <name>.process.ts
        <name>.error.ts
        index.ts
  app/
    commands/
      command.ts
      <name>/
        <name>.command.ts
        <name>.command.error.ts
        index.ts
    queries/
      query.ts
      <name>/
        <name>.query.ts
        <name>.query.error.ts
        index.ts
    ports/
      repos/
        read_options.ts
        subscription.ts           <- Unsubscribe, Listener<T>
        <name>.repo.ts
        <name>.repo.error.ts
        index.ts
      tools/
        .gitkeep
  env/
    transport/
      http.transport.ts
      web_socket.transport.ts
      index.ts
    repos/
      <name>/
        transport.<name>.repo.ts
        <name>.schema.ts          <- zod schemas of the DTOs
        index.ts
    cache/
      register.d.ts
      entity_store.ts
      normalize.ts
      query_options_for.ts
      freshness.ts
      use_read.ts
      use_command.ts
      invalidator.ts
      realtime.sync.ts
      streams/
    tools/
  ui/
    di/
      dependencies.context.ts
    pages/
      <name>/
        ui/
        model/
          <name>.controller.ts
          <name>.store.ts         <- if any
        lib/
    widgets/
      <name>/
        ui/  model/  lib/
  shared/
    ui/
      design/
      tools/
    model/
    lib/
```

---

## 10. Applied examples

### 10.1 Authorization

- `TransportSessionRepo implements SessionRepo` owns the tokens. `attachInterceptors()` (called from `main`) registers the HTTP request/error interceptors and `WebSocketTransport.onBeforeConnect`; refresh on 401 is single-flight inside the repo; login and refresh requests skip interceptors. Expiry is announced through `onExpired`, `main` reacts (`clearAll`, redirect).
- Across tabs, refresh is serialized with the Web Locks API and new tokens are broadcast with `BroadcastChannel`, otherwise token rotation logs out one of the tabs.
- `Login` command merges the guest cart; logout clears the whole cache.
- Prefer an httpOnly cookie session when the backend allows it: most of the above disappears.

### 10.2 Payment

- The backend talks to the payment provider. The frontend only has `OrderRepo`: `createFromCart` returns a hosted payment page URL, the controller redirects.
- The idempotency key is created once per checkout attempt by the controller. `orderId` travels in the return URL. The order status is read by a query; the backend decides that the payment succeeded, never the redirect.
- A declined payment is a result, not an error.

### 10.3 Realtime

- `WebSocketTransport` counts subscribers per channel and resubscribes after reconnect. Ports expose `watch*` methods and two generic repos: `ChangeFeedRepo` (refs that changed) and `ConnectionRepo` (`onGap`: events may have been lost).
- `RealtimeSync` (`env/cache`): an event with content -> `EntityStore.upsert`; an event about composition -> invalidate; a gap -> `invalidateAll`.
- Events and snapshots carry versions; applying an older event is a no-op. Echo of own writes is dropped by client-generated ids.

---

## 11. Intentionally left open

These are decided per feature by the team, not by this document:

- **Infinite lists and pagination.** Cursor conventions and hooks are chosen where they are needed.
- **Retry policy.** What is retried, how often and with which backoff.

---

## 12. Known limitations

- **Offline** is not covered: no command queue, no conflict resolution.
- **One socket per tab.** Acceptable for now; a `SharedWorker` inside `WebSocketTransport` would change nothing above it.
- **`reads` and `writes` are declared by hand.** The CI script checks the vocabulary, not whether declarations match what `execute` actually does. Code review must check both together.
- **The backend contract is load-bearing:** stable ids in every response, versions in events and snapshots, a change feed with `EntityRef`s, acknowledged subscriptions. Without them, the data layer works without guarantees.
- **GraphQL clients with their own cache (Apollo, Relay) are a different architecture**, not a different transport. See 13.

---

## 13. Roadmap: migration to GraphQL

**Goal:** switch the protocol, not the architecture. GraphQL is used as a transport; the query cache and the `EntityStore` stay ours.

**Acceptance criterion for every migration PR:** the diff touches only `env/transport` and `env/repos`. A change in `app/ports` is allowed only in phase 4 and only by adding methods. Anything above the ports (`core`, `app/commands`, `app/queries`, `env/cache`, `ui`) must not change. If it has to, the migration is doing something wrong.

### Phase 0. Preconditions

- The error model (section 5) covers **partial success**: GraphQL can return data and errors at once. Rule: a failed required field throws the port's error, a failed optional field becomes `null`.
- The `EntityStore` merge rules (4.2) are covered by tests with many shapes of one entity. With GraphQL, every document selects its own fields, so partial entities become the norm.
- Every document requests `__typename` and `id`; mappers build `ref` from them.
- Decide on codegen. Generated types give compile-time safety; zod stays at the boundary, because the deployed schema can drift from the one the types were generated from.

### Phase 1. Transport

- `GraphqlTransport` in `env/transport/graphql.transport.ts`, **built on top of `HttpTransport`**, so existing HTTP interceptors (auth headers) apply automatically.
- It converts the `errors` array into a generic `GraphqlError` carrying `extensions.code`, without knowing what the codes mean. The transport boundary holds.
- The session repo extends its error interceptor: `HttpError` 401 **or** `GraphqlError` with `UNAUTHENTICATED` both trigger a refresh.

### Phase 2. Contracts

- One zod schema per document, next to the repo (`<name>.schema.ts`).
- Mappers produce the same domain entities as the REST mappers. Ports do not change.

### Phase 3. Incremental repo migration

- During migration a repo receives both transports: `new TransportOrderRepo(http, graphql)`.
- Methods move one by one. Nothing above the port knows which method has already moved.
- Contract tests run against staging for each migrated method: same input, same domain output as the REST version.

### Phase 4. Aggregated reads (optional)

- Where a query calls several ports to build one result, add an aggregated port method served by one GraphQL document.
- The query's `execute` becomes one call. `reads` does not change: the query still depends on the same data.
- This is the only phase where `app` changes, and only by choice.

### Phase 5. Subscriptions

- GraphQL subscriptions run over `WebSocketTransport` (or a dedicated transport for the subscription protocol).
- `watch*` methods in repos are reimplemented. Ports, `ChangeFeedRepo`, `ConnectionRepo` and `RealtimeSync` do not change.

### Phase 6. Cleanup

- REST paths are removed from repos; repos drop `HttpTransport` from their constructors where it is no longer needed. `HttpTransport` itself stays as the base of `GraphqlTransport`.

### Non-goal

Adopting Apollo or Relay with their normalized caches and fragments colocated with components is **not** part of this roadmap. In those clients the component declares its data; in this architecture the application operation does. Moving to them replaces `env/cache` and `app/queries` and is a separate architectural decision, not a migration step.