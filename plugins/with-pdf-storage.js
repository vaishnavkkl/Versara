const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

module.exports = config => withAndroidManifest(config, config => {
  // Android 10 needs legacy shared-storage access; Android 11+ uses the user's
  // explicit All files access grant. Newer OS versions ignore this flag.
  AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults).$['android:requestLegacyExternalStorage'] = 'true';
  return config;
});
