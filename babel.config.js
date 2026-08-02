module.exports = function (api) {
  api.cache(true);
  return {
    // `@/*` path aliases are resolved by Metro via tsconfig `paths`
    // (expo `experiments.tsconfigPaths`, on by default) and by Jest via
    // `moduleNameMapper` in jest.config.js — no babel resolver needed.
    presets: ['babel-preset-expo'],
    plugins: [
      // react-native-worklets/plugin must stay last (Reanimated 4 requirement).
      'react-native-worklets/plugin',
    ],
  };
};
