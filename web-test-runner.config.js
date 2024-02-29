const {esbuildPlugin} = require('@web/dev-server-esbuild');

module.exports = {
  files: ['./tests/*.test.ts'],
  plugins: [esbuildPlugin({ ts: true })],
  nodeResolve: true,
  testFramework: {
    config: {
      timeout: 20000,
    }
  },
};