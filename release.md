# Audit licensed libraries

> does my project uses any licensed libraries or paid ones, i need confirmation to relase this to app store

<details><summary>11 previous messages</summary>

> I’ll check the app’s dependencies and native integrations against their current license and pricing terms, then flag anything that needs a closer look before release. This will be a release readiness check, not legal advice.
>
> <details><summary>Explored a file, ran 2 commands</summary>
>
> - Ran `rg --files docs . | Select-Object -First 100`
>
> <details><summary>Explored a file</summary>
>
> - Read `./.agents/skills/expo-overview/SKILL.md`
>
> </details>
>
> - Ran `git status --short; rg --files -g '*lock*' -g 'app.json' -g 'app.config.*' -g 'eas.json' -g 'AGENTS.md' -g 'NOTICE*' -g 'LICENSE*'`
>
> <details><summary>Explored a file</summary>
>
> - Read `./package.json`
>
> </details>
>
> </details>
>
> The project has standard Expo dependencies plus a custom native PDF engine. I’m checking that engine’s bundled binaries and notices closely, since those are the most likely place for release obligations.
>
> I’m using the Expo overview guidance for this audit. I found an existing dependency and network audit in `docs/`; I’ll compare it with the current lockfile and the native module’s actual license files.
>
> <details><summary>Explored a file, ran 9 commands, searched the web</summary>
>
> - Ran `Get-Content app.json; Get-Content LICENSE; Get-Content docs/01-product-strategy.md`
> - Ran `rg -n -i 'pdfium|pdfbox|tesseract|leptonica|opencv|ml kit|google|license|commercial|paid|subscription|api key|cloud|purchase|analytics|sentry|admob|stripe|revenuecat' modules scripts plugins src docs/audits/dependency-and-network-audit.md`
> - Ran `Get-Content modules/pdf-engine/THIRD_PARTY_NOTICES.md; Get-Content modules/pdf-engine/LICENSE`
>
> <details><summary>Explored a file</summary>
>
> - Read `./docs/audits/dependency-and-network-audit.md`
>
> </details>
>
> - Ran `Get-Content scripts/prepare-pdfium.mjs; Get-Content scripts/prepare-pdf-ocr.mjs`
>
> Searched the web for `site:docs.expo.dev/versions/v57.0.0/ Expo SDK 57 documentation ...`
>
> - Ran `Get-Content app.json; rg -n 'ML Kit|mlkit|com.google.mlkit|tesseract|tess-two|tesseract4android|vision' modules/file-engine modules/pdf-engine -g '!*.hpp'`
> - Ran `Get-Content modules/file-engine/android/build.gradle; Get-Content modules/pdf-engine/android/build.gradle`
> - Ran `Get-Content modules/file-engine/android/src/main/java/expo/modules/fileengine/ImageText.kt -TotalCount 70; Get-Content docs/29-offline-native-storage-and-ocr.md -TotalCount 110`
> - Ran `node -e "const p=require('./package-lock.json'); const a=Object.entries(p.packages).filter(([k])=>k); const m={}; for(const [k,v] of a){const l=v.license||'MISSING';m[l]=(m[l]||0)+1};console.log(a.length,JSON.stringify(m,null,2));console.log(a.filter(([k,v])=>!/^(MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2.0|0BSD|Unlicense|CC0-1.0|OFL-1.1)$/.test(v.license||'' )).map(([k,v])=>k+' : '+v.license).join('\n'))"`
> - Ran `rg --files modules/pdf-engine/vendor modules/file-engine | rg 'LICENSE|NOTICE|\.traineddata$|\.framework|\.xcframework|\.aar$|\.so$'`
>
> </details>
>
> The current code still includes Google ML Kit for Android image text editing. It is no cost, but proprietary, and one module notice incorrectly says it was removed. I’m checking whether that and the bundled license notices affect what you can safely claim in the App Store listing.
>
> <details><summary>Ran 8 commands, searched the web</summary>
>
> Searched the web for `site:developers.google.com/ml-kit/guides ML Kit free of charge terms use commercial apps ...`
>
> Searched the web for `site:developers.google.com/ml-kit/guides ML Kit no cost free ...`
>
> - Ran `rg -n -i 'license|copyright|permission|source|font' src/constants/edit-fonts.ts modules/file-engine/ios modules/file-engine/android/src/main/assets assets -g '*.md' -g '*.txt' -g '*.swift' -g '*.ts'`
> - Ran `rg --files assets modules | rg '\.(ttf|otf|woff|svg|png|jpg|jpeg|webp)$|LICENSE|NOTICE' | Select-Object -First 150`
> - Ran `Get-Content modules/file-engine/THIRD_PARTY_NOTICES.md; Get-Content modules/pdf-engine/vendor/android-assets/licenses/tesseract/NOTICE; Get-Content modules/pdf-engine/vendor/android-assets/licenses/tesseract/LICENSE -TotalCount 20`
> - Ran `rg -n -i 'license|attribution|third.party|notice' src/app src/features modules/pdf-engine/ios modules/pdf-engine/PdfEngine.podspec`
> - Ran `rg -n 'fetch\(|axios|https?://|apiKey|process\.env|EXPO_PUBLIC|eas\.projectId|revenuecat|stripe|admob|sentry' src modules plugins app.json -g '!*.hpp' -g '!*.cpp' -g '!*.json' | Select-Object -First 100`
> - Ran `git -c safe.directory=C:/Users/vaish/Desktop/project/Versara status --short`
> - Ran `$env:EXPO_NO_TELEMETRY='1'; $env:EXPO_OFFLINE='1'; npx expo lint`
> - Ran `npx tsc --noEmit`
>
> </details>
>
> The dependency review is complete. I found no paid runtime SDK or license key, but I cannot give an unconditional release signoff yet: the in-app license screen is only a summary, and the stale ML Kit notice needs correction. I’m finishing the required static checks now.
>
> <details><summary>Ran 5 commands</summary>
>
> - Ran `& .\node_modules\.bin\tsc.cmd --noEmit`
> - Ran `$env:EXPO_NO_TELEMETRY='1'; $env:EXPO_OFFLINE='1'; & .\node_modules\.bin\expo.cmd lint`
> - Ran `Get-Content src/constants/edit-fonts.ts -TotalCount 100; Get-Content modules/pdf-engine/PdfEngine.podspec -TotalCount 45`
> - Ran `Get-Content src/app/'(tabs)'/settings/index.tsx -TotalCount 165`
> - Ran `Get-ChildItem assets/fonts/edit -Name | Select-Object -First 80; Get-ChildItem node_modules/@expo-google-fonts/sora -Name | Select-Object -First 30`
>
> </details>
>
> TypeScript passes. Expo lint is still running without output; the repository also has unrelated local edits, which I’m leaving untouched.
>
> <details><summary>Ran a command</summary>
>
> - Ran `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node|expo' } | Select-Object ProcessId,Name,CommandLine`
>
> </details>

</details>

**Your project uses licensed libraries, but I found no paid runtime SDK, license key, or per-document processing fee in the current dependencies.** The main components include Expo/React Native, PDFium, PDFBox, Tesseract, and bundled fonts under open-source or open-font licenses. Those licenses generally permit commercial apps, subject to their notice terms. [MIT license](https://opensource.org/license/mit), [Open Font License FAQ](https://openfontlicense.org/ofl-faq/)

I **cannot confirm full license compliance for release yet**. The [in-app licenses screen](</C:/Users/vaish/Desktop/project/Versara/src/app/(tabs)/settings/index.tsx:25>) lists names but not the required license texts and copyright notices, and I have not verified what reaches the final IPA. The [file-engine notice](/C:/Users/vaish/Desktop/project/Versara/modules/file-engine/THIRD_PARTY_NOTICES.md:3) also incorrectly says Google ML Kit was removed; it remains declared in the [Android module](/C:/Users/vaish/Desktop/project/Versara/modules/file-engine/android/build.gradle:25). ML Kit is **no cost but proprietary** and sends usage metrics; that affects Android disclosures, not the iOS build. [ML Kit cost](https://developers.google.com/ml-kit/guides), [ML Kit terms](https://developers.google.com/ml-kit/terms)

For an **Apple App Store** release, budget for the Apple Developer Program: **US$99 per membership year**, or the local price shown at enrollment. EAS has a limited free tier; a paid EAS plan is optional unless you need more capacity. [Apple](https://developer.apple.com/programs/enroll/), [Expo plans](https://docs.expo.dev/billing/plans/)

TypeScript passed. Expo lint started but stalled without output, so I cannot report a lint pass. No files were changed.

> how can i make my app to top in play store

<details><summary>2 previous messages</summary>

> I’ll check Google Play’s current guidance and tailor the launch advice to Versara’s PDF and image tools.
>
> <details><summary>Searched the web</summary>
>
> Searched the web for `site.play.google.com/console/about/store-listing-experiments Google Play store listing experiments ...`
>
> Searched the web for `site:support.google.com/googleplay/android-developer user ratings reviews installs incentivized fraudulent ...`
>
> </details>

</details>

**You can improve Versara’s visibility, but nobody can guarantee a top ranking.** I’d first target people searching for offline PDF tools, then grow from there.

For your app, I would prioritize these steps:

1. **Give Versara a clear promise.** Lead with “PDF and image tools that work offline, without an account.” Promote three useful workflows—merge PDFs, convert images to PDF, and sign documents—so people immediately understand its value.

2. **Make the store listing specific.** A possible title is **“Versara: PDF & Image Tools”**. Use real screenshots showing a task and its finished result. Include relevant phrases naturally; Google prohibits repetitive keywords and misleading ranking claims. [Metadata guidance](https://support.google.com/googleplay/android-developer/answer/9898842?hl=en)

3. **Make those workflows reliable on affordable phones.** Test large PDFs, image exports, cancellations, and reopening saved files. Monitor crashes and freezes in Play Console: poor Android vitals can reduce visibility. [Android vitals](https://developer.android.com/games/optimize/vitals)

4. **Find your first real users.** Start with students, teachers, and office workers who handle documents regularly. Share short videos such as “Combine assignment PDFs on your phone.” Watch where users struggle and fix those problems before spending heavily on promotion.

5. **Earn honest reviews.** Request a review after users have successfully used the app several times. Avoid rewards, purchased reviews, or asking specifically for five stars. [Review guidance](https://developer.android.com/guide/playcore/in-app-review), [Ratings policy](https://support.google.com/googleplay/android-developer/answer/9898684?hl=en)

6. **Improve the listing with evidence.** Use Play Console’s free listing experiments to compare screenshots, icons, and descriptions. Test one asset at a time and allow at least a week. Track installs **and whether users keep using the app**. [Listing experiments](https://play.google.com/intl/eng_ALL/console/about/store-listing-experiments/)

There is also a concrete release issue in your project: **Versara requests “All files access.”** Google requires a declaration and approval for that permission. Document management can qualify, but you must explain why narrower file access is insufficient. Resolve that, the license notices, and ML Kit privacy disclosures before launch. [All files access policy](https://support.google.com/googleplay/android-developer/answer/10467955?hl=en-GB)

My suggested first-month target is **100 genuine users who successfully finish a document task**, followed by improvements based on their feedback. That gives you a useful foundation for growth.

> go through new play console policies and tell me anything to add, like new policy suggest it should be efficient also follow odex also obfuscation to show on top

<details><summary>9 previous messages</summary>

> I’ll check the latest Google Play policies against Versara’s configuration, including DEX optimization, shrinking, and obfuscation. I’ll identify concrete changes and explain which ones affect store visibility.
>
> <details><summary>Ran 5 commands, searched the web</summary>
>
> Searched the web for `site:developer.android.com google play DEX code optimization 25% February 2027 obfuscation shrinking ...`
>
> - Ran `rg --files docs android .agents | rg 'AGENTS.md|build.gradle|gradle.properties|proguard|AndroidManifest|audit|architecture|privacy|phase|strategy'; Get-Content docs/02-architecture.md; Get-Content docs/05-privacy-network-device.md`
> - Ran `Get-Content package.json; Get-Content app.json; Get-Content .agents/skills/expo-overview/SKILL.md`
>
> Searched the web for `site:support.google.com/googleplay/android-developer policy deadlines 2026 September ...`
>
> - Ran `Get-Content android/app/build.gradle; Get-Content android/gradle.properties; Get-Content android/app/proguard-rules.pro; Get-Content android/build.gradle`
> - Ran `Get-Content .agents/skills/eas-app-stores/SKILL.md -TotalCount 180; Get-Content docs/01-product-strategy.md -TotalCount 80`
> - Ran `Get-Content android/app/src/main/AndroidManifest.xml; Get-Content modules/pdf-engine/android/CMakeLists.txt; Get-Content plugins/with-pdf-storage.js; rg -n 'baseline|profileinstaller|dontobfuscate|dontoptimize|dontshrink|enableMinify|enableShrink|targetSdk|page.size|16k|16384|privacyPolicy|privacy policy' package.json app.json modules plugins scripts src android -g '!*.hpp' -g '!*.h' -g '!*.cpp' -g '!*.xml' -g '!*.lock' -g '!*.txt'`
>
> </details>
>
> Google has announced a relevant change: from February 2027, memory usage, bitmap usage, and DEX optimization can affect visibility. Versara’s release configuration appears to leave R8 minification and resource shrinking disabled, so that is a concrete gap. Enabling them can improve efficiency and avoid a visibility penalty; it does not guarantee a top ranking.
>
> <details><summary>Ran 2 commands, searched the web</summary>
>
> Searched the web for `site:developer.android.com/guide/practices/page-sizes November 1 2025 16 KB ...`
>
> - Ran `rg -n 'enableMinify|enableShrink|minifyEnabled|shrinkResources|proguardFiles|signingConfig|targetSdk|compileSdk' android/app/build.gradle android/gradle.properties; rg -n 'compileSdk|targetSdk|ndkVersion|agp' node_modules/expo/android node_modules/expo-modules-core/android node_modules/react-native/gradle -g '*.toml' -g '*.gradle' -g '*.properties'; Get-Content .agents/skills/eas-app-stores/references/play-store.md -TotalCount 150`
>
> Searched the web for `site:support.google.com/googleplay/android-developer user data privacy policy all apps active public non geofenced PDF ...`
>
> - Ran `rg -n 'memory|budget|trim|onTrimMemory|onStop|onPause|onDetached|clearCache|shutdown|release|MAX_|Runtime.getRuntime|lowRam|isLowRamDevice|active' modules/file-engine/android/src/main/java/expo/modules/fileengine/ImageProcessing.kt modules/file-engine/android/src/main/java/expo/modules/fileengine/ImageTools.kt modules/file-engine/android/src/main/java/expo/modules/fileengine/RecentImagesView.kt modules/pdf-engine/android/src/main/java/expo/modules/pdfengine/PdfEngineView.kt src/features/pdf/pdf-preview-queue.ts src/features/files/thumbnail-cache.ts | Select-Object -First 110; rg --files -g '*baseline*' -g '*startup*' -g 'eas.json' -g '*policy*' -g '*privacy*' -g '*proguard*' -g 'bun.lock*'`
>
> </details>
>
> I also found release issues to address first: the Android manifest includes All files access, broad photo access, and an overlay permission, while the privacy screen needs to account for ML Kit’s metrics. The PDF engine already has a 16 KB linker setting, but that alone does not verify its prebuilt PDFium and OCR libraries. I’m checking those details before recommending changes.
>
> <details><summary>Ran 5 commands, searched the web</summary>
>
> Searched the web for `site:support.google.com/googleplay/android-developer "All apps" "privacy policy" "PDF" ...`
>
> - Ran `@'
const fs = require('fs');
for (const arch of ['arm64','x64']) {
 const file='modules/pdf-engine/vendor/android-'+arch+'/lib/libpdfium.so';
 if (!fs.existsSync(file)) { console.log(file+': missing'); continue; }
 const b=fs.readFileSync(file); if (b[4]!==2 || b[5]!==1) { console.log(file+': unexpected ELF'); continue; }
 const off=Number(b.readBigUInt64LE(32)), size=b.readUInt16LE(54), count=b.readUInt16LE(56); const loads=[];
 for (let i=0;i<count;i++) { const p=off+i*size; if(b.readUInt32LE(p)===1) loads.push({alignment:Number(b.readBigUInt64LE(p+48)), offset:Number(b.readBigUInt64LE(p+8)),vaddr:Number(b.readBigUInt64LE(p+16))}); }
 console.log(JSON.stringify({file,bytes:b.length,loads,aligned16K:loads.every(x=>x.alignment>=16384 && (x.vaddr-x.offset)%16384===0)}));
}
'@ | node`
> - Ran `rg -n 'targetSdkVersion|compileSdkVersion|ndkVersion' node_modules/expo-modules-autolinking/android node_modules/expo/android node_modules/expo-modules-core/android -g '*.kt' -g '*.gradle' -g '*.toml' -g '*.properties'; rg -n 'external fun|JNIEXPORT|Java_' modules/pdf-engine/android/src/main modules/file-engine/android/src/main -g '*.kt' -g '*.cpp'; Get-ChildItem -Name eas.json,bun.lock,bun.lockb -ErrorAction SilentlyContinue`
>
> Searched the web for `https://support.google.com/googleplay/android-developer/answer/10144311?hl=en`
>
> - Ran `rg -n 'JNIEXPORT|Java_|external fun|consumerProguardFiles|proguardFiles' modules/pdf-engine/android modules/file-engine/android -g '*.kt' -g '*.cpp' -g '*.gradle'; rg -n 'SYSTEM_ALERT_WINDOW|requestPermissions|startActivityForResult|READ_MEDIA_IMAGES|MANAGE_EXTERNAL_STORAGE' modules/file-engine/android/src/main/java -g '*.kt' | Select-Object -First 30; rg -n 'LICENSES|PRIVACY|no tracking' src/app/'(tabs)'/settings/index.tsx; Get-Content modules/file-engine/android/build.gradle -TotalCount 40`
> - Ran `$env:EXPO_OFFLINE='1'; $env:EXPO_NO_TELEMETRY='1'; node node_modules/expo/bin/cli lint`
> - Ran `node node_modules/typescript/bin/tsc --noEmit`
>
> Searched the web for `https://developer.android.com/topic/performance/app-optimization/enable-app-optimization`
>
> </details>
>
> The 64-bit PDFium binaries pass a static 16 KB alignment check. The code also already bounds image memory, limits preview caches, and handles memory pressure. The remaining performance work is to enable release optimization, check the complete app bundle, and measure startup and background memory on devices. For “ODEX,” Android generates the compiled files; Baseline and Startup Profiles are what you can add to guide that process.
>
> <details><summary>Ran a command</summary>
>
> - Ran `Get-Content eslint.config.js; node node_modules/eslint/bin/eslint.js src modules --quiet`
>
> </details>
>
> I’m using the EAS App Stores guidance to check the release setup. I found no production EAS profile, and the checked-in Android release template uses debug signing, so production signing and AAB packaging need verification. TypeScript passes; lint is still running without output.

</details>

**Yes—Versara needs release optimization and a few policy fixes.** I checked Google’s current guidance as of **2 October 2026** against your project. These changes improve release readiness and can prevent reduced visibility; they do not guarantee a top ranking.

| Priority                  | Finding in Versara                                                                               | Recommended action                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Now**                   | Release minification and resource shrinking default to disabled.                                 | Enable R8 optimization, obfuscation, and resource shrinking.                                                                                                                                                                                                                                                                                                                                                                 |
| **Now**                   | Release uses `proguard-android.txt`, which disables optimization.                                | Switch to `proguard-android-optimize.txt` and review broad keep rules. [R8 guidance](https://developer.android.com/topic/performance/app-optimization/enable-app-optimization)                                                                                                                                                                                                                                               |
| **Now**                   | All files access and broad photo access are declared.                                            | Prepare separate permission declarations explaining why system pickers cannot support essential functionality. If that justification is insufficient, use narrower access. Document and photo editors can qualify, but approval is required. [File access](https://support.google.com/googleplay/android-developer/answer/10467955), [Photo access](https://support.google.com/googleplay/android-developer/answer/14115180) |
| **Now**                   | Main Android manifest includes `SYSTEM_ALERT_WINDOW`; I found no app feature requiring overlays. | Exclude this permission from the production build and verify the final merged manifest.                                                                                                                                                                                                                                                                                                                                      |
| **Now**                   | Privacy text says “no analytics,” although Android ML Kit sends metrics.                         | Correct that claim, publish a complete privacy policy, and match the Play Data safety declaration to the actual SDK behavior. [User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311), [ML Kit disclosures](https://developers.google.com/ml-kit/android-data-disclosure)                                                                                                                |
| **Verify before release** | SDK defaults indicate target API **36**, which meets the current requirement.                    | Confirm API 36 or higher in the finished AAB. [Target API policy](https://support.google.com/googleplay/android-developer/answer/11926878)                                                                                                                                                                                                                                                                                   |
| **Verify before release** | No `eas.json` production profile; the Android release template uses debug signing.               | Configure a production AAB build and verify production signing.                                                                                                                                                                                                                                                                                                                                                              |

For R8, the concrete changes are in [build.gradle](/C:/Users/vaish/Desktop/project/Versara/android/app/build.gradle:69) and [gradle.properties](/C:/Users/vaish/Desktop/project/Versara/android/gradle.properties):

```properties
android.enableMinifyInReleaseBuilds=true
android.enableShrinkResourcesInReleaseBuilds=true
android.r8.optimizedResourceShrinking=true
```

Also replace the default ProGuard file with `proguard-android-optimize.txt`. Your installed Android Gradle Plugin is 8.12, where optimized resource shrinking requires that third setting. Preserve the PDF engine’s JNI entry point and required reflective APIs, then verify PDF editing, OCR, navigation, and fonts in the optimized release. Keep its `mapping.txt` for readable crash reports. These settings need durable Expo configuration so regeneration preserves them. [Android guidance](https://developer.android.com/topic/performance/app-optimization/enable-app-optimization), [Expo SDK 57 settings](https://docs.expo.dev/versions/v57.0.0/sdk/build-properties/)

**The upcoming efficiency requirements matter for your app:**

- **February 2027:** memory usage, bitmap memory, and DEX optimization can affect visibility. For apps with **more than 10 MB of DEX code**, Google lists **25% minimum coverage** for optimization, obfuscation, and shrinking. This means coverage—not a requirement to reduce APK size by 25%. Your actual coverage needs verification after building. [Android vitals](https://developer.android.com/games/optimize/vitals)
- **16 KB compatibility:** Google’s current guidance lists **1 February 2027** as the update enforcement date. Your 64-bit PDFium binaries passed a static alignment check, and your custom PDF library has the linker setting. The complete AAB—including OCR and other native libraries—still needs verification. [16 KB guidance](https://developer.android.com/guide/practices/page-sizes)
- **ODEX:** Android’s runtime generates these compiled files. Add measured **Baseline and Startup Profiles** for launch, file browsing, and opening PDFs to guide compilation and improve startup. I found no app-specific profiles; dependencies may supply their own. [Profiles guidance](https://developer.android.com/topic/performance/baselineprofiles/overview)

Your code already contains memory budgets, bounded PDF caches, and memory-pressure cleanup. Build on those controls and measure background bitmap retention and native memory on devices.

Finally, check Play Console’s developer registration status—the published deadline was **30 September 2026**. If yours is a personal account created after 13 November 2023, production access also requires **12 testers continuously opted in for 14 days**. [Policy deadlines](https://support.google.com/googleplay/android-developer/table/12921780), [Testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)

No files were changed. TypeScript passed; both lint attempts stalled without output and were stopped.
