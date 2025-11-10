import { expect, test } from '@playwright/test';
import type { TestInfo } from '@playwright/test';
import { environment, finishAudit, observe, settleAudit, type Audit } from './api-audit';
import { capture, expand, names, ready, recordJson, rename, state } from './api-editor';

const audits = new WeakMap<TestInfo, Audit>();

test.beforeEach(async ({ page }, testInfo) => {
    const audit: Audit = {
        errors: [],
        requests: [],
        responses: [],
        pending: [],
    };
    audits.set(testInfo, audit);
    observe(page, audit);
});

test.afterEach(async ({ page }, testInfo) => {
    await finishAudit(page, testInfo, audits.get(testInfo)!);
});

for (const fixture of [
    {
        format: 'json',
        content: '{"name":"Alice","amount":12,"details":[{"code":"A"}]}',
    },
    {
        format: 'yaml',
        content: 'name: Alice\namount: 12\ndetails:\n  code: A\n',
    },
    {
        format: 'xml',
        content: '<invoice><name>Alice</name><amount>12</amount><details><code>A</code></details></invoice>',
    },
]) {
    test(`persists a real ${fixture.format} schema through the federated editor`, async ({
        page,
        browser,
    }, testInfo) => {
        const audit = audits.get(testInfo)!;
        const title = `Persisted ${fixture.format} invoice`;
        await page.goto('/');
        await page.getByLabel('Schema title').fill(title);
        await page.locator('input[type="file"]').setInputFiles({
            name: `invoice.${fixture.format}`,
            mimeType: 'text/plain',
            buffer: Buffer.from(fixture.content),
        });
        await page
            .getByRole('button', {
                name: 'Create schema',
                exact: true,
            })
            .click();
        await ready(page);
        await expect(page.getByText(
            fixture.format === 'xml' ? 'XSD 1.0' : 'JSON Schema 2020-12',
            { exact: true }
        )).toBeVisible();
        expect((await state(page)).document).toMatchObject({
            revision: 's1',
            operations: [],
        });
        await expect.poll(() => new URL(page.url()).searchParams.get('schemaId'))
            .not.toBeNull();
        const schemaId = new URL(page.url()).searchParams.get('schemaId');
        expect((await names(page)).sort()).toEqual([
            'amount',
            'details',
            'name',
        ]);
        await recordJson(testInfo, 'environment', await environment(page, browser.version()));
        await capture(page, testInfo, 'inferred-schema');
        await expand(page, 'details');
        await expect.poll(() => names(page)).toContain('code');
        await capture(page, testInfo, 'expanded-schema');
        await rename(page);
        const operations = (await state(page)).document.operations;
        expect(operations).toHaveLength(1);
        expect(operations[0]).toMatchObject(
            fixture.format === 'xml'
                ? {
                      kind: 'renameXmlName',
                      name: {
                          namespaceUri: null,
                          localName: 'customerName',
                      },
                  }
                : {
                      kind: 'renameProperty',
                      name: 'customerName',
                  }
        );
        await page
            .getByRole('button', {
                name: 'Save schema',
                exact: true,
            })
            .click();
        await expect.poll(async () => (await state(page)).document.revision).toBe('s2');
        expect((await state(page)).document.operations).toEqual([]);
        const creations = audit.requests.filter(request =>
            request.method === 'POST' && request.path === '/api/v2/schemas'
        ).length;
        await settleAudit(audit);
        await page.reload();
        await ready(page);
        expect(new URL(page.url()).searchParams.get('schemaId')).toBe(schemaId);
        expect((await state(page)).document).toMatchObject({
            revision: 's2',
            operations: [],
        });
        expect(await names(page)).toContain('customerName');
        expect(audit.requests.filter(request =>
            request.method === 'POST' && request.path === '/api/v2/schemas'
        )).toHaveLength(creations);
        await capture(page, testInfo, 'direct-reload-schema');
        await settleAudit(audit);
        await page
            .getByRole('button', {
                name: 'Exit editor',
                exact: true,
            })
            .click();
        const saved = page.getByRole('link', {
            name: new RegExp(title),
        });
        await expect(saved).toContainText('1 source document · s2');
        await settleAudit(audit);
        await page.reload();
        await expect(saved).toContainText('1 source document · s2');
        await saved.click();
        await ready(page);
        await expect.poll(() => names(page)).toContain('customerName');
        expect((await state(page)).document.revision).toBe('s2');
        await capture(page, testInfo, 'persisted-schema');

        const freshContext = await browser.newContext({
            baseURL: 'http://127.0.0.1:4173',
            viewport: {
                width: 1440,
                height: 1000,
            },
            deviceScaleFactor: 1,
        });

        try {
            const freshPage = await freshContext.newPage();
            observe(freshPage, audit);
            await freshPage.goto('/');
            await freshPage.getByRole('link', {
                name: new RegExp(title),
            }).click();
            await ready(freshPage);
            expect((await names(freshPage)).sort()).toEqual([
                'amount',
                'customerName',
                'details',
            ]);
            expect((await state(freshPage)).document).toMatchObject({
                revision: 's2',
                operations: [],
            });
            await capture(freshPage, testInfo, 'fresh-context-schema');
            await settleAudit(audit);
        } finally {
            await freshContext.close();
        }

        await settleAudit(audit);
        const upload = audit.requests.find(
            request => request.method === 'POST' && request.path === '/api/v2/analyses'
        )!;
        expect(upload.idempotencyKey).toBeTruthy();
        expect(JSON.parse(upload.body!)).toEqual({
            title,
            documents: [
                {
                    name: `invoice.${fixture.format}`,
                    format: fixture.format,
                    size: Buffer.byteLength(fixture.content),
                    content: fixture.content,
                },
            ],
        });
        expect(audit.responses.find(response =>
            response.method === 'POST' && response.path === '/api/v2/analyses'
        )).toMatchObject({
            status: 202,
            headers: {
                location: expect.stringMatching(/^\/api\/v2\/analyses\//),
            },
        });
        expect(audit.responses.find(response =>
            response.method === 'POST' && response.path === '/api/v2/schemas'
        )).toMatchObject({
            status: 201,
            headers: {
                etag: expect.stringMatching(/:s1"$/),
            },
        });
        expect(audit.responses.find(response =>
            response.method === 'POST' && response.path.endsWith('/changesets')
        )).toMatchObject({
            status: 201,
            headers: {
                etag: expect.stringMatching(/:s2"$/),
            },
        });
        expect(audit.requests.find(request =>
            request.method === 'POST' && request.path.endsWith('/changesets')
        )?.ifMatch).toMatch(/:s1"$/);
        expect(audit.requests.filter(request => request.method === 'PUT')).toEqual([]);
    });
}
