// const esModules = ['p-time', 'mimic-fn'].join('|');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  globals: {
    'ts-jest': {
      // "transpile-only". because speed and why would we want to compile it everytime anyways!
      isolatedModules: true,
      // useESM: true
    },
  },
  transform: {
    '^.+\\.(ts)?$': 'ts-jest',
  },
  setupFilesAfterEnv: ['@relmify/jest-fp-ts'],
  // transformIgnorePatterns: [`/node_modules/(?!${esModules})`],
  // https://stackoverflow.com/questions/55092607/using-dotenv-path-with-jest
  // setupFiles: ['<rootDir>/test/dotenvConfig.js'],
};