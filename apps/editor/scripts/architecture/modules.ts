import path from 'node:path';
import ts from 'typescript';

export type SourceModule = Readonly<{ name: string; text: string }>;
export type ArchitectureViolation = Readonly<{
    file: string;
    rule: string;
    detail: string;
}>;

const layersWithoutPublicEntry = new Set(['core', 'env', 'shared', 'app', 'main']);

const dependencies: Readonly<Record<string, readonly string[]>> = {
    core: ['core', 'shared'],
    app: ['app', 'core', 'shared'],
    env: ['env', 'app', 'core', 'shared'],
    ui: ['ui', 'app', 'core', 'shared', 'board'],
    board: ['board', 'core', 'shared'],
    shared: ['shared'],
    main: ['main', 'core', 'app', 'env', 'ui', 'board', 'shared'],
    expose: ['expose', 'main', 'ui', 'app'],
    standalone: ['standalone', 'ui', 'board', 'shared'],
};

/** Checks source packages without depending on the filesystem or executing imports. */
export function inspectModules(
    modules: readonly SourceModule[]
): ArchitectureViolation[] {
    const files = new Map(modules.map(module => [module.name, module]));
    const compilerOptions: ts.CompilerOptions = {
        noLib: true,
        types: [],
        noResolve: true,
        target: ts.ScriptTarget.ESNext,
    };
    const compilerHost = ts.createCompilerHost(compilerOptions);
    compilerHost.getSourceFile = name => {
        const module = files.get(name);

        return module
            ? ts.createSourceFile(name, module.text, ts.ScriptTarget.Latest, true)
            : undefined;
    };
    const program = ts.createProgram([...files.keys()], compilerOptions, compilerHost);
    const checker = program.getTypeChecker();
    const violations: ArchitectureViolation[] = [];
    const directories = new Set<string>();
    const graph = new Map<string, string[]>();
    const report = (file: string, rule: string, detail: string) => {
        violations.push({ file, rule, detail });
    };

    for (const module of modules) {
        let directory = path.posix.dirname(module.name);

        while (directory !== '.') {
            directories.add(directory);
            directory = path.posix.dirname(directory);
        }
    }

    for (const directory of directories) {
        const entry = `${directory}/index.ts`;
        const module = files.get(entry);

        if (layersWithoutPublicEntry.has(directory)) {
            if (module) {
                report(
                    entry,
                    'layer-entry',
                    'Architecture layers must not expose index.ts.'
                );
            }

            continue;
        }

        if (!module) {
            report(entry, 'public-entry', 'Every source package must have index.ts.');
        } else if (!/\bexport\b/.test(module.text)) {
            report(entry, 'public-entry', 'The entry must declare its public exports.');
        }
    }

    for (const module of modules) {
        const layer = module.name.split('/')[0];
        const source = program.getSourceFile(module.name);

        if (!source) {
            continue;
        }
        const imports: string[] = [];
        graph.set(module.name, imports);
        const runtime = !/\.(test|spec)\.tsx?$/.test(module.name);

        const check = (specifier: string, typeOnly: boolean) => {
            if (!specifier.startsWith('.')) {
                if (specifier === 'pixi.js' || specifier.startsWith('pixi.js/')) {
                    if (layer !== 'board') {
                        report(module.name, 'pixi-boundary', specifier);
                    }
                }

                if (
                    ['core', 'app', 'board'].includes(layer) &&
                    /^react(?:-dom)?(?:\/|$)/.test(specifier)
                ) {
                    report(module.name, 'framework-boundary', specifier);
                }

                return;
            }

            const requested = path.posix.normalize(
                path.posix.join(path.posix.dirname(module.name), specifier)
            );
            const packageName = requested.replace(/\/index(?:\.tsx?)?$/, '');

            if (layersWithoutPublicEntry.has(packageName)) {
                report(
                    module.name,
                    'layer-import',
                    'Import an owning package instead of an architecture layer.'
                );

                return;
            }

            const target = [
                requested,
                `${requested}.ts`,
                `${requested}.tsx`,
                `${requested}/index.ts`,
            ].find(name => files.has(name));

            if (!target) {
                return;
            }

            const targetLayer = target.split('/')[0];
            const allowed = dependencies[layer];
            const uiCache = layer === 'ui' && target.startsWith('env/cache/');

            if (allowed && !allowed.includes(targetLayer) && !uiCache) {
                report(module.name, 'layer-direction', `${layer} -> ${target}`);
            }

            if (
                module.name.startsWith('env/transport/') &&
                targetLayer !== 'shared' &&
                !target.startsWith('env/transport/')
            ) {
                report(module.name, 'transport-boundary', target);
            }

            if (
                module.name.startsWith('env/cache/') &&
                targetLayer === 'env' &&
                !target.startsWith('env/cache/')
            ) {
                report(module.name, 'cache-boundary', target);
            }

            if (
                ['core', 'app'].includes(layer) &&
                targetLayer === 'shared' &&
                !target.startsWith('shared/lib/')
            ) {
                report(
                    module.name,
                    'framework-boundary',
                    'Business layers may use shared/lib only.'
                );
            }

            if (
                path.posix.dirname(target) !== path.posix.dirname(module.name) &&
                path.posix.basename(target) !== 'index.ts'
            ) {
                report(module.name, 'public-import', specifier);
            }

            if (runtime && !typeOnly) {
                imports.push(target);
            }
        };
        const visit = (node: ts.Node): void => {
            if (
                ts.isImportDeclaration(node) &&
                ts.isStringLiteral(node.moduleSpecifier)
            ) {
                const clause = node.importClause;
                const bindings = clause?.namedBindings;
                const typeOnly =
                    clause?.isTypeOnly === true ||
                    (clause?.name === undefined &&
                        bindings !== undefined &&
                        ts.isNamedImports(bindings) &&
                        bindings.elements.length > 0 &&
                        bindings.elements.every(item => item.isTypeOnly));
                check(node.moduleSpecifier.text, typeOnly);
            } else if (
                ts.isExportDeclaration(node) &&
                node.moduleSpecifier &&
                ts.isStringLiteral(node.moduleSpecifier)
            ) {
                const clause = node.exportClause;
                const typeOnly =
                    node.isTypeOnly ||
                    (clause !== undefined &&
                        ts.isNamedExports(clause) &&
                        clause.elements.length > 0 &&
                        clause.elements.every(item => item.isTypeOnly));
                check(node.moduleSpecifier.text, typeOnly);
            } else if (
                ts.isCallExpression(node) &&
                node.expression.kind === ts.SyntaxKind.ImportKeyword &&
                node.arguments[0] &&
                ts.isStringLiteral(node.arguments[0])
            ) {
                check(node.arguments[0].text, false);
            }

            if (
                runtime &&
                ['core', 'app'].includes(layer) &&
                ts.isIdentifier(node) &&
                /^(window|document|HTMLElement|HTMLCanvasElement|WebGLRenderingContext|WebGL2RenderingContext|Document|Element|Node|MouseEvent|PointerEvent|KeyboardEvent|Request|Response|fetch|localStorage)$/.test(
                    node.text
                )
            ) {
                const propertyName =
                    (ts.isPropertyAccessExpression(node.parent) &&
                        node.parent.name === node) ||
                    (ts.isPropertyDeclaration(node.parent) &&
                        node.parent.name === node) ||
                    (ts.isPropertySignature(node.parent) && node.parent.name === node) ||
                    (ts.isParameter(node.parent) && node.parent.name === node);

                if (!propertyName && !checker.getSymbolAtLocation(node)) {
                    report(module.name, 'browser-boundary', node.text);
                }
            }

            ts.forEachChild(node, visit);
        };
        visit(source);
    }

    const visited = new Set<string>();
    const active = new Set<string>();
    const visit = (file: string, trail: readonly string[]): void => {
        if (active.has(file)) {
            report(
                file,
                'runtime-cycle',
                [...trail.slice(trail.indexOf(file)), file].join(' -> ')
            );

            return;
        }

        if (visited.has(file)) {
            return;
        }

        active.add(file);

        for (const imported of graph.get(file) ?? []) {
            visit(imported, [...trail, file]);
        }

        active.delete(file);
        visited.add(file);
    };

    for (const file of graph.keys()) {
        visit(file, []);
    }

    return violations;
}
