const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { files: ['src/**/*.{ts,tsx}'], plugins: { versara: { rules: { 'native-text': require('./scripts/eslint-native-text.cjs') } } }, rules: { 'versara/native-text': 'error' } },
  { ignores: ['dist/*', '.expo/*'] },
]);
