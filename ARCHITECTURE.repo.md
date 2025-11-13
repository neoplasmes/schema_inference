# Repository Architecture

The general contract for how a repository is laid out, built, and operated,
independent of its languages and frameworks. Read it before adding, moving, or
renaming projects, tools, or configuration.

Project-specific decisions live in `README.md` and the other `ARCHITECTURE.*.md`
documents. They may add rules but must not contradict this one. When this document
and the repository disagree, fix one of them in the same change.

## General convention

These principles decide every case the rest of the document does not cover.

1. **Role over technology.** Directories are organized by purpose (application,
   library, tool, test, environment), never by language or framework.
2. **One owner per file.** Every file has one owning project or tool and one reason
   to change. A file with an unclear owner is misplaced.
3. **One source of truth.** Each setting and version is defined once and referenced
   elsewhere. Two copies are a defect.
4. **Everything pinned.** Tools, dependencies, base images, and providers have exact
   versions in the repository. Nothing floats to `latest`.
5. **Reproducible from a clean clone.** A fresh clone plus `proto install` and moon
   tasks builds, tests, and runs everything, given the OS prerequisites below.
6. **Explicit dependencies.** Every relationship between projects is declared where
   the build system sees it, never implied by hoisting, relative paths, or command
   order.
7. **Same path locally and in CI.** Developers, agents, and CI run the same tasks.
8. **Create on demand.** No empty directories, placeholder projects, or speculative
   abstractions. No folder contains only an `index.ts`. A shared package appears
   with its second consumer.
9. **Folder boundaries.** Every logical code unit has its own folder and public
   entry point; in TypeScript that is `index.ts`, even for a five-line function.
   Consumers import the folder, never its implementation file. Segment barrels
   export child folders; only a module's own barrel references its implementation
   files. Tool-required entries and generated files keep their required paths.

## Toolchain: proto

- Every tool (runtimes, package managers, build tools, infrastructure CLIs, moon
  itself) is installed by `proto` and pinned in the root `.prototools`.
- Custom proto plugins live in `.proto/plugins/<tool>.toml`, registered once in
  `.prototools` through local `file://` locators (`[plugins.tools]`, or the `plugin`
  field under `[tools.<id>]` to override an inherited locator). Third-party plugin
  definitions are kept in the repository, not loaded from remote URLs; built-in
  plugins stay managed by proto.
- Node.js is the JavaScript runtime; JavaScript tools run as `pnpm exec <tool>`.
  pnpm alone installs and locks JavaScript dependencies.
- Ecosystem dev libraries (linters, formatters, test runners, type checkers) are
  pinned in their ecosystem's manifest and lockfile. Standalone CLIs are pinned
  through proto.
- Forbidden: global tools, system package managers, `curl | sh` installers,
  unpinned on-the-fly packages, and other version managers. Installing proto, Docker,
  and Docker Compose are OS prerequisites outside proto.
- CI images install tools with `proto install` from the same `.prototools`; base
  images use the same versions.

## Operations: moon

Task, file group, input, and inheritance rules follow the moonrepo skill. This
section records only repository choices.

- Every project in `apps/`, `packages/`, and `e2e/` has a `moon.yml`. `tools/`
  holds no moon projects; the root project owns their tasks and everything outside
  `apps/` and `packages/`, and never takes the `node` tag.
- Every operation is a moon task: dev servers, quality checks, tests, builds,
  images, deployment, environments. CI, git hooks, documentation, and agents invoke
  moon tasks only; package scripts and shell wrappers are never entry points.
- Shared tasks live in `.moon/tasks.yml` (inherited by every project) and
  `.moon/tasks/`: `<ecosystem>.yml` by tag (`node.yml`), `<language>.yml` by
  language (`typescript.yml`), `<capability>.yml` by tag (`css.yml`).
- Tool-specific root configs (`/biome.json`, `/stylelint.config.js`,
  `/postcss.config.js`) belong to `cfg-fmt`, `cfg-lint`, and `cfg-css` file
  groups, never to `implicitInputs`.
- TypeScript projects define the file groups `src`, `test-unit`, `test-int`,
  `css`, and `cfg`.

### Standard task names

Projects use these names where the operation applies, so one command works
everywhere (`moon run :check`). A `moon.yml` lists tasks in this order: other, code
quality, tests, DX, Docker, local compose.

| Group        | Task                         | Meaning                                                                              | Changes files     |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------ | ----------------- |
| Other        | `setup`                      | Install tools and dependencies.                                                      | No source files   |
| Code quality | `fmt`                        | Formatters only (Biome, Ruff), after the fix tasks. Never linters.                 | Yes               |
| Code quality | `lint`                       | Regular linters (ESLint, Ruff).                                                      | No                |
| Code quality | `lint-fix`                   | Safe fixes from regular linters.                                                     | Yes               |
| Code quality | `lint-css`                   | Style linters (Stylelint).                                                           | No                |
| Code quality | `lint-css-fix`               | Safe fixes from style linters.                                                       | Yes               |
| Code quality | `typecheck`                  | Type checks.                                                                         | No                |
| Code quality | `check`                      | `noop` proxy without inputs: deps on `fmt`, `lint-fix`, `lint-css-fix`, `typecheck`. | Through deps      |
| Tests        | `test-unit`                  | Unit tests: `*.test.<ext>` in `src/` or the project's `tests/`.                      | No                |
| Tests        | `test-int`                   | Integration tests: `*.test.int.<ext>` or `.int/` next to the module.                 | No                |
| Tests        | `test-e2e`                   | End-to-end tests in the project's `e2e/`, outside `src/`.                            | No                |
| DX           | `dev`                        | Run the project locally for development. Persistent.                                 | No                |
| DX           | `build`                      | Produce the project's build output.                                                  | Build output only |
| DX           | `start`                      | Run the built output, where needed.                                                  | No                |
| Docker       | `image`                      | Build the project's container image. Applications only.                              | No                |
| Compose      | `compose-up`, `compose-down` | Start or stop a local compose stack, where needed.                                   | No                |

`check` depends on fix tasks: what can be fixed needs no report, and what cannot
still fails. `lint-fix` and `lint-css-fix` are separate so each caches on its own
inputs. `format`, `format-check`, `lint-styles`, and a bare `test` are not used.
Environment operations (`plan`, `apply`, `deploy`, `promote`, `destroy`) live in
the `env` project. Aggregation uses `moon run :<task>`, not hand-listed projects.

A variant or sub-step of a standard task is named `<standard>-<qualifier>`
(`compose-up-database`, `lint-architecture`, `build-types`).

## Code quality

- **Formatting.** Biome is the only formatter for JS/TS/JSON/CSS, configured in the
  root `biome.json` and pinned in the root `package.json`. Python is formatted by
  Ruff. Markdown and HTML are not formatted. `.zed/settings.json` runs Biome on save
  instead of Prettier, without overriding the user's language-server choice. `fmt`
  runs only the Biome and Ruff formatters, after the fix tasks.
- **Linting.** Formatting and semantic linting are separate. JS/TS uses ESLint;
  each TypeScript project owns its `eslint.config.js`. Python uses Ruff (lint) and
  pyright (typecheck).
- **Frontend tool tasks** run from the workspace root, pass their project
  directory explicitly, declare `root` as a dependency, and run JavaScript tools as
  `pnpm exec <tool>`.
- **CSS.** Plain CSS Modules and PostCSS Preset Env, cascade order
  `reset, tokens, primitives, typography, components`. Typography classes from the global
  `typography.css` are attached in JSX. `packages/design-system/src/theme/tokens.css`
  is the hand-maintained token source. The root `postcss.config.js` is shared by
  Vite and Storybook; it runs `postcss-preset-env` against the root Browserslist
  and prepends the layer order from `theme.css` to every stylesheet, so CSS loaded
  before the theme keeps the cascade. Lightning CSS minifies. Feature policy:
  `docs/adr/minor/adr-minor-postcss-preset-env.md`.
- **CSS linting.** Stylelint runs with the root `stylelint.config.js` and
  the root-owned `stylelint-use-nesting` and `stylelint-order` plugins; there is no
  project-specific plugin. Token rules use regexps built at config load by
  `tools/exctract-tokens-to-stylelint`, which reads `tokens.css` and writes no
  files. Frontend CSS checks depend on the design-system CSS check, so token
  changes invalidate them.

## HTTP API tests

- HTTP API tests are integration tests against a running service. Unit tests of
  domain logic, commands, and queries stay in the language's test framework.
- Python projects follow pytest conventions (`tests/unit/`, `tests/integration/`,
  `test_*.py`); TypeScript follows the task table (`*.test.<ext>`,
  `*.test.int.<ext>`, `e2e/`).
- Single-service tests belong to that application; multi-application scenarios
  belong in `e2e/<suite-name>/`.
- Environments and fixtures are explicit. Local and CI runs share scenarios;
  base URLs and credentials come from outside.

## Directory layout

```text
.proto/
    plugins/
        <tool>.toml          # custom proto plugin definitions
.moon/
    workspace.yml
    tasks.yml                # inherited by every project
    tasks/
        <tag-or-language>.yml # node.yml, typescript.yml, css.yml
apps/
    <app-name>/              # deployable application, one container image
packages/
    <package-name>/          # library consumed by other projects
tools/
    <tool-name>/             # repository tooling, never deployed, no moon.yml
e2e/
    <suite-name>/            # tests that exercise several apps together
env/
    local/                   # local stacks: docker-compose.<topic>.yaml
    ...                      # cloud, cluster, delivery; structured by the project
docs/
    adr/
        major/               # repository-wide technical decisions (MADR)
        minor/               # small local technical decisions (MADR)
AGENTS.md
lefthook.yml
ARCHITECTURE.repo.md         # this document
ARCHITECTURE.<topic>.md      # project-specific architecture documents
README.md
.prototools
moon.yml                    # root project: repository-wide and aggregate tasks
.dockerignore
.gitignore
<ecosystem workspace roots>  # manifests and lockfiles, one set per package manager
```

### What goes where

| Directory         | Contains                                                                                                                                                                            | Does not contain                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/`           | Deployable applications, each with its own `Dockerfile` and image.                                                                                           | Code imported by other projects.                                         |
| `packages/`       | Libraries imported by apps or other packages.                                                                                                                     | Deployables, repository tooling.                                         |
| `tools/`          | Tooling run on the repository: shared tool configuration packages, custom checks, generators, git hooks. Not moon projects.                                          | Application runtime code.                                                |
| `e2e/`            | Test suites that start or call more than one app.                                                                                                                                   | Single-project tests; those live in the project.                         |
| `env/`            | Infrastructure as code, cluster bootstrap, deployment charts, delivery and promotion scripts, the local compose stacks.                                                              | Application source, package-manager configuration, proto plugins.        |
| `docs/adr/`       | Technical decision records in MADR: `major/ADR.major.<topic>.md`, `minor/ADR.minor.<topic>.md`.                                                                                     | Business and UX decisions.                                               |
| `.proto/plugins/` | Custom proto plugin definitions.                                                                                                                                                    | Tool binaries, caches, local proto state.                                |
| Root              | Tool workspace roots (`.prototools`, `.proto/`, `.moon/`, manifests, lockfiles), repository-wide agent, editor, and CI configuration, architecture documents, the root `moon.yml`, tool configuration files that tools expect at the root (e.g. `ty.toml`, `biome.json`, `.pnpmfile.cjs`, `skills-lock.json`). | Scripts, source code. |

Shared Biome, Stylelint, PostCSS, and TypeScript configuration lives at the root;
every TypeScript project extends the root `tsconfig.json`. ESLint configuration is
per project. Other tool configuration belongs in `tools/` or `env/`.

## Naming

- Repository and backend files and directories use lowercase kebab-case;
  everything in `tools/` does, without exception. Frontend source, including
  `packages/design-system`, follows the rules below instead.
- Frontend files and folders that are not React components use lower camelCase:
  hooks, controllers, services, entities, commands, queries, utilities, domain
  groups, model modules (`pageData/pageData.ts`, `useRead/useRead.ts`), and the
  `ui`, `model`, `lib` segments.
- Folders whose primary purpose is a React component, widget roots included, and
  component files use PascalCase (`RepeatedPageComponent/RepeatedPageComponent.tsx`);
  their CSS modules use lower camelCase (`repeatedPageComponent.module.css`).
  Widgets are reused on more than one distinct page and live at
  `widgets/WidgetName/WidgetName.widget.tsx` with `widgetName.widget.module.css`.
  Pages own `<PageName>.page.tsx`, `<pageName>.page.module.css`, populated
  segments, and `index.ts` at the slice root
  (`executor/catalog/ExecutorCatalog.page.tsx`); see
  [the page slice contract](ARCHITECTURE.frontend.md#page-slices).
- Page and widget child components are extracted only for repeated use within the
  owner or to split a file over 300 lines, with recursive `ui`, `model`, `lib`
  segments and `index.ts`; see
  [the widget contract](ARCHITECTURE.frontend.md#widget-slices-and-recursive-components).
- Dots separate extensions and semantic suffixes: `biome.json`,
  `button.module.css`, `Button.stories.tsx`, `route-tree.gen.ts`, `iconModules.d.ts`.
- Tool-required names stay: `AGENTS.md`, `CLAUDE.md`, `README.md`, `README.txt`,
  `ARCHITECTURE.md`, `ARCHITECTURE.<topic>.md`, `Dockerfile`, TanStack Router's
  `__root.tsx`, route filenames, configured router entries, generated files, and
  dotfiles.
- `node_modules` and everything inside dot-prefixed directories are never renamed.
  Ordinary files in `refs/` are not exempt.
- ADR files are `ADR.major.<topic>.md` or `ADR.minor.<topic>.md`. Dots separate
  fields, kebab-case joins words within a field. Code identifiers follow their
  language.
- A project's directory name is its moon id; a different id is set with `id` in
  `moon.yml` (`e2e/browser` with `id: e2e-browser`).
- Paths never contain language or framework names: `apps/billing`, not
  `apps/go-billing`.
- Project names describe the domain or job; no `common`, `shared`, `utils`,
  `helpers`, or `misc`. Internal module and package names follow the language.
- Top-level names `apps`, `packages`, `tools`, `e2e`, `env`, `docs`, `.proto` are
  reserved. New top-level directories require a change to this document.

## Package-manager workspaces

- Each ecosystem has one workspace root at the repository root with one committed
  lockfile. CI installs in frozen mode.
- Workspace members are listed explicitly, not globbed, because `apps/`,
  `packages/`, and `tools/` mix languages. After adding one, `moon query projects`
  must show it with the expected language.
- Each project declares its own application dependencies. Root-owned tooling
  (Biome) is resolved from the root by tasks run there.
- Shared tool configuration is a `tools/` package projects depend on, except the
  root-owned Biome, Stylelint, PostCSS, and TypeScript configs.
  Projects never reach configuration through `../../`.
- Tooling that must not affect application dependencies may keep its own
  workspace root and lockfile in its `tools/` project, stated in its `AGENTS.md`.

## Containers: Docker

- Every application has its own `Dockerfile` and image; packages, tools, and tests
  have none.
- The build context is the repository root; the `image` task names the Dockerfile.
- Dockerfiles are multi-stage, cache dependency downloads, copy only needed
  manifests, lockfile, and members, and ship only runtime artifacts.
- Base images are pinned to versions matching `.prototools`.
- Processes run unprivileged; every image has a health endpoint or command.
- The root `.dockerignore` excludes secrets, local state, caches, dependencies,
  and build output.
- Images are tagged by commit and deployed by digest. The tested image is promoted
  between environments, never rebuilt.
- Runtime configuration comes from environment variables and mounted files, never
  baked in. Build-time settings that bind an image to one environment are
  documented.
- Local stacks live in `env/local/` as `docker-compose.<topic>.yaml` (topic = what
  the stack is about, e.g. `docker-compose.database.yaml`), started by moon tasks
  `compose-up[-<topic>]` and `compose-down[-<topic>]`.

## Agents

- The root `AGENTS.md` is every agent's entry point: communication and working
  rules plus links to architecture documents. `CLAUDE.md` and similar files only
  point to it. A project `AGENTS.md` adds local rules; agents read the root, then
  the nearest one. Language-wide rules go in the root `AGENTS.md`.
- Agents run operations through moon tasks, like CI.
- Agents never write secrets, credentials, state, or personal data into the
  repository, logs, or commits.
- Parallel writers use separate worktrees or disjoint files; lockfiles and shared
  config have one owner per task. Review agents report, never edit or commit.

## Git and commits

- Git hooks are declared in the root `lefthook.yml`. `pre-commit` runs
  `moon run :fmt :typecheck --affected --status staged` and restages fixed files
  (`stage_fixed`).
- Commits follow Conventional Commits.
- One commit is one coherent, verified change; moving projects and changing their
  content are separate commits.

## Secrets and local state

- Secrets live in `.secrets/`, caches in `.cache/`, run output in `.local/`; all
  are git-ignored and excluded from build contexts.
- Only placeholder templates named `*.example` are versioned.
- Infrastructure state lives outside disposable compute and is a secret.

## Adding a project

1. Create `apps/<name>`, `packages/<name>`, `tools/<name>`, or `e2e/<name>` by role.
2. Add `moon.yml` with `language`, `tags`, `dependsOn`, the standard file
   groups, and only tasks `.moon/tasks/` does not provide. `tools/` gets none.
3. Add it to the package manager's member list and install to update the lockfile.
4. For an application, add its `Dockerfile`, `image` task, and compose service.
5. Add a project `AGENTS.md` only for rules beyond the root ones.
6. Verify with `moon query projects` and `moon run <name>:check <name>:test-unit`.

## Changing this document

Changes to layout, naming, toolchain rules, or workspace roots update this document
in the same commit. Moving a project updates every reference to its path:
Dockerfiles, compose, delivery scripts, agent configuration, and documentation.
