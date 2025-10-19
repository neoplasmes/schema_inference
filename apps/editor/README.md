# Schema editor

The editor is a separately built Webpack Module Federation remote. React owns its shell; PixiJS 8.14 owns the entire board. The host imports only `schema_editor/Editor` or `schema_editor/mount`.

## Run

Use the repository's pinned Node 22.20.0, pnpm 10.18.3 and moon 1.41.5.

```sh
moon run root:install-frontend
moon run client:dev
```

This starts the editor at `http://localhost:3010` and host at `http://localhost:3000`. Open `/edit?demo=1` on the host for the explicitly marked fixture demo. Use `localhost` consistently: mixing a host at `127.0.0.1` with a remote at `localhost` triggers development server cross-site checks.

```sh
moon run editor:playground
moon run editor:visual
moon run editor:perf
pnpm --dir apps/editor exec tsx visual/browser.ts
moon run editor:typecheck editor:lint editor:test editor:build
moon run client:build
```

Playground scenes use `http://localhost:3010/?scene=card-anatomy`. Other reference scenes: `main`, `variants`, `replace-preview`, `loading`, `lod`, `builder`. Visual verification requires the external design directory at `/home/neoplasmes/third_course_reimagined/artifacts/schema-editor-design` and Playwright Chromium installed with `pnpm --dir apps/editor exec playwright install chromium`. It uses HTTP and software WebGL in headless Linux/WSL. Browser interaction checks require both development servers running. Screenshots and comparisons are ignored build artifacts under `visual/actual` and `visual/compare`.

If global modern proto configuration prevents the pinned proto from parsing its settings, use the repository-local home without changing the global configuration:

```sh
PROTO_HOME="$PWD/.proto" /home/neoplasmes/.proto/tools/proto/0.53.4/proto run moon -- run client:dev
```

## Remote contract

```ts
export type EditorResource =
  | { kind: 'schema'; schemaId: string; revision?: string }
  | { kind: 'analysis'; analysisId: string; revision: string; rootAlternativeId?: string };

export type EditorProps = {
  resource: EditorResource;
  apiBaseUrl: string;
  onExit?: () => void;
  onSaved?: (result: { schemaId: string; revision: string; savedAt: string }) => void;
};
```

`apiBaseUrl` is the service origin or deployment prefix, without `/api/v2`. An empty string uses the page origin. The adapter appends the versioned paths from ADR 0001. `schema` opens a document; `analysis` creates a draft from an immutable analysis revision. `onSaved` runs only after a confirmed server changeset; `savedAt` is the client confirmation time. `fixture://standalone` explicitly selects in-memory demonstration data and never emits a server-save callback.

The existing backend has no durable API v2 yet. Its upload session ID cannot serve as a schema ID. Production resources display an explicit error if API v2 is unavailable; they never fall back to fixture data. The old upload workflow remains at `/edit/legacy` in the host.

Both builds use `@module-federation/enhanced` 0.20.0. Only `react` and `react-dom` are shared singletons with versions read from package manifests. The remote does not use the router and owns PixiJS. The asynchronous `index`/`bootstrap` boundary permits shared dependency negotiation before React starts.

The host fetches `/editor-runtime.json` on each load attempt, then registers the remote using its `mf-manifest.json`. Development middleware reads `EDITOR_REMOTE_MANIFEST_URL` and `EDITOR_API_BASE_URL`. In production deploy this runtime file alongside the host, independently of its JavaScript bundle:

```json
{
  "editorManifestUrl": "https://editor.example.org/mf-manifest.json",
  "apiBaseUrl": "https://api.example.org"
}
```

Serve remote chunks and its manifest with CORS permitting the host. Retain immutable hashed chunks for active clients; refresh manifests rather than deleting chunks from an active release. The checked-in production configuration intentionally has no deployment URL. Configure it before deployment. Schema requests use normal fetch credentials defaults; cross-origin authentication configuration is not implemented.

The producer generates `dist/@mf-types.zip`. The host's type preparation consumes this generated archive using `unzip`; `EDITOR_TYPES_URL` can select a deployed archive. Build types must correspond to the intended remote contract. Runtime version changes remain a deployment compatibility responsibility.

```tsx
import { lazy, Suspense } from 'react';
import { loadRemote, registerRemotes } from '@module-federation/enhanced/runtime';
import type { EditorProps } from 'schema_editor/Editor';
import type { ComponentType } from 'react';

registerRemotes([{ name: 'schema_editor', entry: runtimeConfiguration.editorManifestUrl }]);
const Editor = lazy(async () => {
  const module = await loadRemote<{ default: ComponentType<EditorProps> }>('schema_editor/Editor');

  if (!module) throw new Error('Editor could not load');

  return module;
});

<Suspense fallback={<p>Loading editor...</p>}>
  <Editor resource={{ kind: 'schema', schemaId: 'orders' }} apiBaseUrl={runtimeConfiguration.apiBaseUrl} />
</Suspense>;
```

Wrap this in an error boundary that recreates the lazy loader on retry. The existing host provides that boundary. A non-React host can load `schema_editor/mount`:

```ts
const module = await loadRemote<typeof import('schema_editor/mount')>('schema_editor/mount');
if (!module) throw new Error('Editor could not load');
const instance = module.mount(element, props);
instance.update(nextProps);
instance.unmount();
```

Each mount owns its document and graphics resources. Updating the resource starts a new session and abandons local unsaved edits. Returning to a fixture resource starts a clean demonstration. `unmount` is idempotent; updates after unmount throw. The fallback uses the remote's React share fallback when the host provides none.

## Board contract

The board is a React-free UI module. Server decoding belongs to `env`, document-to-board projection belongs to `ui/pages/editor`, and document semantics belong to the framework-free `core`/`app` layers. A board model contains presentation cards, stable member IDs, connections, selection and load states; it is not a saved schema.

```ts
import { createSchemaBoard, type BoardModel } from './src/board';

const board = createSchemaBoard({ container: element });
await board.ready;
board.setModel(model satisfies BoardModel);
const unsubscribe = board.on('rename', ({ memberId, name }) => controller.rename(memberId, name));
board.viewport.fitAll();
board.viewport.zoomTo('customer-block');
const camera = board.viewport.get();
board.viewport.set(camera);
unsubscribe();
board.destroy();
```

This import is internal to the editor or its tests, not a third federation export. `theme` permits per-instance token overrides. `arrange()` runs deterministic tree layout while preserving pinned cards. `getGeometry()` and `getStats()` support verification. `destroy()` cancels initialization, rendering, observers, input and text resources.

| Event | Meaning |
|---|---|
| `select`, `hover` | Card/member identity or null |
| `rename` | Member identity and proposed name |
| `move` | Card position, or member transfer with stable destination identity |
| `expand` | Member branch visibility |
| `variantChange` | Observed variant and scope; not a document edit |
| `loadMore` | Request the next collection page |
| `add` | Request creation from the palette; the minimal shell explains that creation is unavailable |
| `viewportChange` | Camera after a gesture or explicit camera action |

Events are intentions. The controller validates document operations and projects the result back through `setModel`. Camera and hover feedback update locally without a React rerender on every pointer movement. The only board DOM overlay is the temporary rename input. DOM panels provide an accessible tree; board keyboard controls include arrow navigation, Enter, F2 and Escape. The camera currently changes without animation, including when reduced motion is requested.

A card renders a local window of at most ten loaded rows. Wheel input over those rows scrolls the card; wheel input elsewhere pans the board, and Ctrl+wheel zooms toward the cursor. Keyboard navigation and connection boundary indicators reveal the owning row by stable member identity. Loading another server page and scrolling an already loaded row window are separate actions.

LOD means level of detail. Zoom is clamped to 0.12..3: overview below 0.35, working from 0.35 through 1.2, detailed above 1.2. Overview hides row text. Standard card header/row heights are 34/28 px; illustrative anatomy/detail fixtures use explicit metrics described in ADR 0002.

Tokens are generated with `pnpm --dir apps/editor sync-tokens`. CSS variables are scoped to `.schema-editor`; component styles use CSS Modules. The source design package is not copied into the repository. See `docs/editor/VISUAL_REVIEW.md`, `PERF.md` and `STATUS.md` for measured evidence and remaining product work.

## Source packages

`core` defines schema values and pure editing rules. `app` owns commands, queries, repository ports and the document replica with undo history. `env` implements transport, contract decoding and page caching. `main` constructs these dependencies; `ui/di` provides ready operations to UI controllers. React pages and widgets live in `ui`, while `board` remains an independent imperative UI package.

Packages expose their public API through `index.ts`. The layer roots `core`, `env`, `shared`, `app` and `main` have no `index.ts`; import the owning package inside a layer. Import another package through its directory, not its implementation files. Files inside one package may import each other directly. `editor:lint` checks these entries, layer directions, framework isolation and runtime import cycles. The source root `index.ts` remains the asynchronous application entry.

Board packages separate geometry, viewport, text, interactions and rendering. Rendering has card, row, labels, chrome, scene layers and lifecycle modules; interactions have pointer, keyboard, selection, rename and gesture modules. The generated DOM tokens live in `src/shared/ui/theme/tokens.css`; board tokens remain in `src/board/theme/tokens.ts`.
