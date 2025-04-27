module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    sourceType: 'module',
  },
  plugins: [
    '@typescript-eslint',
    'import',
    'unused-imports',
    'jsdoc',
  ],
  extends: [
    'airbnb-base',
    'airbnb-typescript/base',
  ],
  rules: {
    'no-console': 'off',
    'import/prefer-default-export': 'off',
    'unused-imports/no-unused-imports': 'error',
  },
};
