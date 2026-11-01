const projectBuildDirectories = require('./scripts/project-build-directories.cjs');
const workerProjects = require('./scripts/worker-projects.cjs');

module.exports = {
  modulePathIgnorePatterns: [
    ...projectBuildDirectories.map(directory => `<rootDir>/${directory}/`),
    '<rootDir>/.codex-',
    '<rootDir>/.codex/',
    '<rootDir>/.worktrees/',
    '<rootDir>/artifacts/',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  preset: '@react-native/jest-preset',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // jsdom's encoding, HTML parser, and CSS dependencies now ship ES modules.
  transform: {
    '^.+\\.mjs$': 'babel-jest',
    // UI tokens register their fonts; tests only need an asset ID.
    '^.+\\.(ttf|otf)$': require.resolve('@react-native/jest-preset/jest/assetFileTransformer.js'),
  },
  // Match the innermost node_modules to transform nested ES modules while
  // leaving jsdom's CommonJS internals untouched.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|react-native-keyboard-controller|lucide-react-native|@shopify/flash-list|@react-native(-community)?|expo/virtual|@exodus/bytes|parse5|entities|@asamuzakjp|@csstools)/)(?!.*node_modules/)',
  ],
  testPathIgnorePatterns: [
    ...workerProjects.testIgnorePatterns,
    '<rootDir>/.codex-',
    '<rootDir>/__tests__/mockWhipSsh.js',
  ],
};
