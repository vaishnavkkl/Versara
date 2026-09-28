const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod, withInfoPlist, AndroidConfig } = require('expo/config-plugins');

const legacyDomains = ['root', 'file', 'database', 'sharedpref', 'external'];
const modernDomains = [...legacyDomains, 'device_root', 'device_file', 'device_database', 'device_sharedpref'];
const exclusions = (domains, indent) => domains.map(domain => `${indent}<exclude domain="${domain}" path="." />`).join('\n');

module.exports = config => {
  // This policy covers app-owned storage. User-exported files belong to their
  // selected destination/provider and are outside the application's backup policy.
  config = withInfoPlist(config, config => {
    config.modResults.VersaraExcludeAppDataFromBackup = true;
    return config;
  });
  config = withAndroidManifest(config, config => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    application.$['android:allowBackup'] = 'false';
    application.$['android:fullBackupContent'] = '@xml/versara_backup_rules';
    application.$['android:dataExtractionRules'] = '@xml/versara_data_extraction_rules';
    return config;
  });
  return withDangerousMod(config, ['android', async config => {
    const directory = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'versara_backup_rules.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<full-backup-content>\n${exclusions(legacyDomains, '  ')}\n</full-backup-content>\n`);
    await writeFile(path.join(directory, 'versara_data_extraction_rules.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<data-extraction-rules>\n  <cloud-backup>\n${exclusions(modernDomains, '    ')}\n  </cloud-backup>\n  <device-transfer>\n${exclusions(modernDomains, '    ')}\n  </device-transfer>\n</data-extraction-rules>\n`);
    return config;
  }]);
};
