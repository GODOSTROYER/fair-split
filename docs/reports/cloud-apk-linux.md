# Cloud T4: Android APK build on Linux

Branch `cloud/apk-linux`, cut from `origin/main` at `3e1ec112`. Handoff task T4 (`docs/handoff/cloud.md` on
`cloud/handoff`). Status: **in progress** (APK built; size experiments running).

## Toolchain (installed in the session, outside the repo)

| Tool                       | Version                                                                                                      | How                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| OpenJDK                    | 17.0.20.1+1 (Ubuntu 24.04 package)                                                                           | `apt-get install openjdk-17-jdk-headless` (apt verifies the archive signatures)                      |
| Android command-line tools | 23.0 (`commandlinetools-linux-16111833_latest.zip`)                                                          | from `dl.google.com`; SHA-1 `e025545c…f60` matches `repository2-3.xml`                               |
| SDK packages               | `platforms/android-37.0`, `build-tools/37.0.0`, `ndk/27.1.12297006`, `cmake/3.31.6`, `platform-tools` 37.0.1 | `android sdk install …` (versions from `react-native/gradle/libs.versions.toml` and `app.config.ts`) |
| Build-Tools 36.0.0         | 36.0.0                                                                                                       | installed by AGP itself during the build (a library module's default)                                |
| Gradle                     | 9.4.1 (the generated project's wrapper)                                                                      | wrapper download from `services.gradle.org`                                                          |
| actionlint                 | 1.7.12 (31 Mar 2026)                                                                                         | release tarball from GitHub, SHA-256 checked against `actionlint_1.7.12_checksums.txt`               |
| shellcheck                 | 0.9.0 (Ubuntu package)                                                                                       | used by actionlint for the `run:` blocks                                                             |

Expo 58.0.20, `@expo/cli` 58.1.16, React Native 0.88.0 (AGP 9.2.1, compileSdk 37, targetSdk 36, minSdk 24),
expo-build-properties 58.0.11. Node 24.22.1.

`cmdline-tools` 23.0 turns `sdkmanager` into a deprecated shim over the new "Android CLI" (`android sdk …`):
`sdkmanager --licenses` prints "no longer needed" and writes no `licenses/` folder, and `sdkmanager "<unknown>"`
exits 0 after printing "not found". `android sdk install` wrote `licenses/android-sdk-license`, which was enough
for AGP to auto-install Build-Tools 36 later. The workflow therefore checks every package folder after installing.

## What ran

```bash
cd apps/mobile
CI=1 EXPO_NO_TELEMETRY=1 corepack pnpm exec expo prebuild --platform android --no-install   # 7 s; git status clean
cd android
EXPO_PUBLIC_API_ORIGIN=https://fs-api.onrender.com NODE_ENV=production \
JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ANDROID_HOME=/opt/android-sdk GRADLE_USER_HOME=<scratch>/gradle-home \
nice -n 10 ./gradlew assembleRelease --no-daemon --max-workers=2 \
  --init-script <scratch>/abi-splits.init.gradle --init-script <scratch>/central-mirror.init.gradle \
  "-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g" -Pkotlin.daemon.jvmargs=-Xmx2g \
  -Dorg.gradle.internal.repository.max.retries=10 -Dorg.gradle.internal.repository.initial.backoff=500
```

- `EXPO_PUBLIC_API_ORIGIN` is the value every EAS profile gets (`apps/mobile/eas.json`, `build.base.env`).
- R8 and resource shrinking come from the repo: `expo-build-properties` sets `enableMinifyInReleaseBuilds` and
  `enableShrinkResourcesInReleaseBuilds`, which prebuild writes into `android/gradle.properties`
  (`android.enableMinifyInReleaseBuilds=true`, `android.enableShrinkResourcesInReleaseBuilds=true`).
- `abi-splits.init.gradle` (scratch, not committed) turns on `splits.abi` for the four ABIs with `universalApk true`,
  so one build gives the per-ABI APKs and the universal APK without editing the generated project.
- The generated `apps/mobile/android/` is ignored twice (`.gitignore`: `apps/mobile/android/`;
  `apps/mobile/.gitignore`: `/android`), and `git status` stayed clean throughout. The keystore was generated in the
  session's scratch folder and never entered the worktree.

## Network: what was blocked

- **Maven Central rate-limits this session's egress IP.** `repo.maven.apache.org` answered **HTTP 429 Too Many
  Requests** to about 40% of requests (12 sequential GETs of one POM: 5 × 429, 7 × 200). Two builds failed on it
  (`foojay-resolver:1.0.0`, `kotlin-gradle-plugin:2.2.21`), and Gradle's own retries
  (`org.gradle.internal.repository.max.retries=10`) did not get through. The Gradle Plugin Portal redirects
  Central-hosted artifacts to `repo.maven.apache.org`, so rewriting the repository URLs alone was not enough either.
- **Workaround (local only):** `central-mirror.init.gradle` (scratch, not committed) puts Google's mirror of Maven
  Central, `https://maven-central.storage-download.googleapis.com/maven2/`, first in every repository list and
  rewrites direct Central URLs to it. The mirror answered 200 every time. The CI workflow does not use it: GitHub's
  runners reach Central directly.
- Not blocked: `dl.google.com` (SDK), `maven.google.com`, `services.gradle.org` (wrapper), `plugins.gradle.org`,
  the npm registry, GitHub release downloads.

## Memory on the shared machine

The first build that got past dependency resolution (`-Xmx4g`, a separate Kotlin daemon at `-Xmx2g`) was
OOM-killed by the kernel after 257 tasks, while the arm64-v8a CMake builds of expo-modules-core and reanimated ran
(load average 30, other agents using about 8 GB). Three Kotlin compile daemons from earlier attempts were still
alive (about 2.5 GB); they were stopped by PID. The rerun uses `-Xmx3g -XX:MaxMetaspaceSize=768m`,
`kotlin.compiler.execution.strategy=in-process`, `org.gradle.daemon=false` and `--max-workers=2`. The CMake object
files from the killed run were kept (`node_modules/**/android/.cxx`), so the rerun resumes the native work.

## Results

**An R8 release APK built** (`BUILD SUCCESSFUL in 1h 3m 46s`, 22:21 to 23:25 UTC, load average 37 at the start and
14 at the end; it resumed the native objects of the OOM-killed run, so a clean build on this shared machine takes
longer). R8 ran (`:app:minifyReleaseWithR8`), resources were shrunk, and every APK passes
`zipalign -c -P 16 4` (16 KB page alignment for the uncompressed native libraries).

Signed with the throwaway key (`apksigner sign`, then `apksigner verify`: v2 and v3 schemes, one signer):
`CN=build-check, OU=throwaway, O=Fair Split build-check`, certificate SHA-256
`6133d30a2c8839844bef83648a872170780527a92e774f2963ab235d6c078e6d` (RSA 2048, valid 30 days, PKCS12 in the
session's scratch folder; never in the repo, not pushed anywhere).

### Size per ABI against the 35 MB budget

The budget is the design direction's "APK ≤ 35 MB per ABI, including armeabi-v7a" (performance budgets; also
S2 and the plan). Real split APKs from `splits.abi` (one build, init script), signed with build-check. MB = 2^20 bytes.

| APK                   |       Bytes |     MB | Native libs (stored) | Budget                | SHA-256                                                            |
| --------------------- | ----------: | -----: | -------------------: | --------------------- | ------------------------------------------------------------------ |
| arm64-v8a             |  44,413,810 |  42.36 |             29.25 MB | **over by 7.36 MB**   | `b7f496fc467553bae5a401f0f1acca355eec1f6f71e01769f3b99a608a4266ae` |
| armeabi-v7a           |  34,681,778 |  33.08 |             19.95 MB | within (1.92 MB left) | `73786382ed51590e5debab4b7c87bcbabbfb195141a392d6510c7cd2c4be5f31` |
| x86_64                |  47,137,554 |  44.95 |             31.82 MB | **over by 9.95 MB**   | `9aafb74594ec09a06e5c111b8bf4fd8cbfc5732ec62ccf3aeec57c88413bf06b` |
| x86                   |  47,080,114 |  44.90 |             31.78 MB | **over by 9.90 MB**   | `903a3f3c7db40b2ba752c9678f6f0006b9b0e25242a7e63b11ee57edf3f22384` |
| universal (four ABIs) | 132,788,454 | 126.64 |            112.80 MB | n/a (not per ABI)     | `cdccade27ef3fa67d365e15cde4e146345cfbd2194dcd2e9ec7d6b930ae50a55` |

The hashes are of these build-check-signed files; any other key gives other hashes (the workflow prints its own).
Signing is deterministic: the workflow's sign step, run locally with the same key on the same unsigned APK, gave
the same universal hash.

Where the arm64-v8a APK's 42.4 MB goes (stored bytes): native libraries 30.7 MB (`libreactnative` 7.0 MB,
`libbarhopper_v3` 4.9 MB, `libhermesvm` 2.7 MB, `libexpo-sqlite` 1.9 MB, `libreanimated` 1.7 MB,
`libexpo-modules-core` 1.6 MB, `libc++_shared` 1.3 MB, `libworklets` 1.3 MB, …); `assets/` 6.4 MB (the Hermes
bundle 5.4 MB, ML Kit barcode models 0.9 MB, the six fonts 0.15 MB); `classes*.dex` 5.0 MB; `resources.arsc`
1.1 MB; `res/` 0.5 MB. The native libraries are **stored uncompressed** (`expo.useLegacyPackaging=false`, the
SDK 58 default) so they can be memory-mapped and page-aligned; that is why they cost their full size in the APK.
`libbarhopper_v3` is the bundled ML Kit barcode scanner (expo-camera `barcodeScannerEnabled: true`).

### Other findings in the built APK

- `org.fairsplit.app`, versionName 0.1.0, versionCode 1, compileSdk 37, targetSdk 36, minSdk 24.
- **JS bundle over its budget.** `assets/index.android.bundle` is Hermes bytecode (magic `c6 1f bc 03`) of
  5,414,480 bytes against the design direction's "JS bundle ≤ 3 MB". The budget does not say whether it means the JS
  source or the shipped bytecode; this is the shipped file. Measuring the minified JS source was not done.
- **`SYSTEM_ALERT_WINDOW` ships in the release manifest.** It comes from the Expo prebuild template's main
  `AndroidManifest.xml` (template default permissions), not from a library. The app config's least-privilege
  comment ("no microphone anywhere, and nothing writes to shared storage") is honoured (`RECORD_AUDIO` and
  `WRITE_EXTERNAL_STORAGE` are absent), but the draw-over-other-apps permission is not needed by a release build.
  Fix, if WS-APP agrees: add `"android.permission.SYSTEM_ALERT_WINDOW"` to `android.blockedPermissions` in
  `apps/mobile/app.config.ts` (it also removes it from the dev-client build; check the dev menu still opens).
  Not changed here: it is a product decision, not a build problem.
- `expo-dev-client` classes ship in the release dex (`expo.modules.devlauncher`: 6 classes; `expo.modules.devmenu`:
  package present), as Expo's release stubs. Small; noted for the size budget only.
- Other permissions come from libraries (camera, biometrics, notifications with FCM `c2dm.RECEIVE`, launcher badge
  permissions from expo-notifications' ShortcutBadger, `READ_EXTERNAL_STORAGE` capped at SDK 32 by
  expo-image-picker, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` from expo-audio's `enableBackgroundPlayback`).

### Experiment: compressed native libraries

Pending (the run was cut by a container restart; rerunning).
