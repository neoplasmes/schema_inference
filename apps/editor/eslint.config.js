import javascript from '@eslint/js';
import globals from 'globals';
import typescript from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default typescript.config(
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'visual/actual/**',
            'visual/compare/**',
        ],
    },
    {
        files: [
            '**/*.{ts,tsx}',
        ],
        extends: [
            javascript.configs.recommended,
            ...typescript.configs.recommended,
        ],
        languageOptions: {
            parserOptions: {
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        plugins: {
            'react-hooks': reactHooks,
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/consistent-type-imports': 'error',
            'react-hooks/rules-of-hooks': 'error',
            curly: [
                'error',
                'all',
            ],
        },
    }
);
