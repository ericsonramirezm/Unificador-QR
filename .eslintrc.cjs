// ESLint estaba declarado en package.json ("npm run lint") pero nunca
// instalado ni configurado: el comando fallaba en cualquier máquina limpia,
// y había cinco comentarios "eslint-disable-next-line" silenciando reglas de
// un linter que no corría.
//
// Se usa el formato .eslintrc (ESLint 8) y no el "flat config" nuevo porque
// es el que la mayoría de los editores todavía detecta sin configuración
// adicional.
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react-hooks', 'jsx-a11y'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'plugin:jsx-a11y/recommended'],
  ignorePatterns: ['dist', 'node_modules', 'scripts', '*.cjs'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    // El proyecto tiene deuda conocida de `any` (ver el TODO en
    // supabase.ts sobre generar tipos con `supabase gen types`). Se deja
    // como advertencia para no bloquear el build mientras se va saldando.
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

    // Hay varios catch que ignoran el error a propósito y están comentados.
    'no-empty': ['error', { allowEmptyCatch: true }],

    // El código usa punto y coma iniciales a propósito, para protegerse de
    // la inserción automática de punto y coma cuando una línea empieza con
    // "[" o "(" (ver escaneoDocumento.ts y opencv.worker.ts). La regla los
    // considera "innecesarios" y --fix los borraba, que es justo lo que no
    // se quiere.
    'no-extra-semi': 'off',

    // Accesibilidad: importa de verdad acá porque los <label> del proyecto
    // no estaban asociados a sus inputs.
    'jsx-a11y/label-has-associated-control': ['warn', { assert: 'either' }],
  },
}
