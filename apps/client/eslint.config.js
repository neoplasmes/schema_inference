import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/build/**',
        ],
    },
    {
        files: [
            'src/**/*.{js,jsx,ts,tsx}',
            'scripts/**/*.ts',
            'tests/**/*.ts',
            '*.config.ts',
        ],
        extends: [
            js.configs.recommended,
            ...tseslint.configs.recommended,
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
            '@stylistic': stylistic,
            'react-hooks': reactHooks,
        },
        rules: {
            curly: [
                'error',
                'all',
            ],
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': 'warn',
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/consistent-type-imports': [
                'error',
                {
                    prefer: 'type-imports',
                    fixStyle: 'separate-type-imports',
                },
            ],
            '@typescript-eslint/no-empty-object-type': 'off',
            '@stylistic/padding-line-between-statements': [
                'error',
                {
                    blankLine: 'always',
                    prev: '*',
                    next: [
                        'return',
                        'throw',
                        'break',
                        'continue',
                    ],
                },
            ],
            'react-hooks/rules-of-hooks': 'error',
        },
    }
);
