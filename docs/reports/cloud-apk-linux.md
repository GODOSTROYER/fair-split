# Cloud T4: Android APK build on Linux

Branch `cloud/apk-linux`, cut from `origin/main` at `3e1ec112`. Handoff task T4 (`docs/handoff/cloud.md` on
`cloud/handoff`). Status: **done**. The APK built and is reported below; three ABIs miss the 35 MB budget, and a fix is projected.

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
  5,414,480 bytes against the design direction's "JS bundle ≤ 3 MB". The minified JS before Hermes is over too:
  4,526,631 bytes (1,096,264 gzipped), from `expo export:embed --platform android --dev false --minify true`, the
  command Gradle's bundle task runs. Its source map (Metro's indexed map, one section per module, 2,289 modules)
  splits the 4.53 MB as: react-native 688 KB (15.2%), react-native-reanimated 655 KB (14.5%), **zod 538 KB
  (11.9%)**, expo-router 492 KB (10.9%), `apps/mobile/src/features` 439 KB (9.7%), react-native-gesture-handler
  197 KB, react-native-svg 126 KB, react-native-worklets 108 KB, **`packages/contracts` 103 KB**, expo 102 KB,
  @noble/curves 78 KB, `src/_shims` 78 KB, `media/statement-plans.json` 53 KB, `media/audio/manifest.json` 53 KB.
- **zod and every contract schema are in the phone bundle (641 KB, 14%)**, which `apps/mobile/AGENTS.md` and
  `src/_shims/contracts.ts` set out to prevent ("a runtime import would carry zod and every schema into each phone
  frame"). The app's own shim is type-only; the leak comes through `@fairsplit/api-client`, which imports contract
  schemas at runtime (`client.ts` and `http.ts`: `API_COMMANDS`; `media.ts`: `StatementAudio`,
  `StatementAudioQuery`; `run-lines.ts`: `LineCanonical`, `MemberLineDTO`, `RunSlug`; `sse.ts`: `RunEvent`;
  `statement-shapes.ts`: `MemberLineState`, `MoneyDTO`, `PayoutItemStatus`, `Provenance`), and the app imports
  api-client at runtime (`src/_shims/api-client.ts`, `src/features/statement/http-statement.ts`,
  `src/features/statement/discovery.ts`). Metro does not tree-shake, so `contracts/src/index.ts` brings in every
  schema file and zod. Not fixed here: `packages/api-client` is WS-API's and `apps/mobile/src` is off limits. Two
  ways out: a schema-free api-client entry for the phone (for example `@fairsplit/api-client/lite`), or plain
  values instead of schemas in the six files above. Repro: the export command above with
  `--sourcemap-output <file>`, then group `sections[].map.sources[0]` by package.
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

### Experiment: compressed native libraries (projected, not built)

`./gradlew assembleRelease -Pexpo.useLegacyPackaging=true` (compress the `.so` files in the APK) was started three
times. The machine killed it each time: the kernel OOM killer once during R8, then two container restarts. So the
numbers below are a projection: each split APK's native libraries were re-deflated with `zip -9`, and the
difference was taken off the real APK size. The Android packager's deflate level may differ slightly.

| ABI         | Built (MB) | Libraries stored → deflated (MB) | Projected APK (MB) | Budget |
| ----------- | ---------: | -------------------------------: | -----------------: | ------ |
| arm64-v8a   |      42.36 |                    29.25 → 10.57 |              23.67 | within |
| armeabi-v7a |      33.08 |                     19.95 → 9.19 |              22.32 | within |
| x86_64      |      44.95 |                    31.82 → 11.49 |              24.63 | within |
| x86         |      44.90 |                    31.78 → 11.72 |              24.84 | within |

The setting is one line of build config, `android.useLegacyPackaging: true` in the `expo-build-properties` plugin
entry in `apps/mobile/app.config.ts` (it writes `expo.useLegacyPackaging=true`). The trade-off: the installer
extracts the libraries, so the app takes more space on the device after install (about the 29 MB of arm64
libraries again), and the first install is slightly slower. Play's AAB does the opposite by default. For an APK
that judges download from GitHub Releases, download size is what matters. **Not committed**, because the budget
choice is WS-APP's and the build that would prove it did not finish here. Next step: run `android-apk.yml` once
with the line added, and read the per-ABI table in the job summary.

## What changed (branch `cloud/apk-linux`)

| Commit    | Scope | What                                                                                             |
| --------- | ----- | ------------------------------------------------------------------------------------------------ |
| `62fe9a5` | qa    | report skeleton                                                                                  |
| `3168242` | qa    | `.github/workflows/android-apk.yml`: manual APK build, optional release signing, SHA-256, upload |
| `cbd93bb` | qa    | report: toolchain, Maven Central 429s, the OOM                                                   |
| `1e561f2` | qa    | workflow: per-ABI estimate against the 35 MB budget, signer DN, no v4 `.idsig`                   |
| `ff44aa6` | qa    | report: sizes, hashes, manifest findings                                                         |
| (this)    | qa    | report: JS bundle analysis, compressed-libraries projection, open items                          |

No app-scope (`app`) commit was needed: `expo prebuild` and `assembleRelease` with R8 worked with the repo's
`app.config.ts`, `eas.json` and `metro.config.js` as they are. Every fix to a build _problem_ was to this machine's
network or memory, and those fixes live in the session's scratch folder (init scripts, Gradle flags), not in git.

### The workflow, `.github/workflows/android-apk.yml`

- `workflow_dispatch` only; `ubuntu-latest`; JDK 17 from `actions/setup-java` (Temurin); Gradle caches
  (`~/.gradle/caches`, `~/.gradle/wrapper`) through `actions/cache`, keyed on `pnpm-lock.yaml` and `app.config.ts`
  (there is no `android/` folder to hash before prebuild).
- Installs the SDK packages React Native names (`libs.versions.toml`: compileSdk, buildTools, ndkVersion) and the
  app config's CMake. It checks each folder afterwards, because the cmdline-tools 23 `sdkmanager` shim exits 0 on
  unknown packages.
- `expo prebuild --platform android --no-install`, then `./gradlew assembleRelease` with
  `EXPO_PUBLIC_API_ORIGIN` read from `apps/mobile/eas.json` (`build.base.env`).
- Signing: with all four secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD`), `apksigner sign` (v2 and v3) into `fair-split-<version>-<sha7>-release-signed.apk`,
  artifact `fair-split-apk-<sha7>-release-signed`. Otherwise the debug signature stays and the file is
  `…-debug-signed-not-release-signed.apk`, artifact `fair-split-apk-<sha7>-not-release-signed`, with a warning.
  Passwords go to apksigner through `env:`, never on a command line. The decoded keystore lives in `$RUNNER_TEMP`
  and is removed straight after signing and again in an `always()` step.
- Then `apksigner verify`, `zipalign -c -P 16 4`, and a job summary with the SHA-256, the size, the signer DN and a
  per-ABI table against the 35 MB budget. The APK and its `.sha256` are uploaded with 14-day retention.
- Pins (full SHA, same style as `ci.yml`): checkout v7.0.1, setup-node v7.0.0 and cache v6.1.0, as in
  `docs/versions.md`. New: `actions/setup-java` **v6.1.0** `b843ebf9b913146b38da2eaa7aeddf76074ae1ad` (commit
  14 Oct 2026) and `actions/upload-artifact` **v7.0.2** `cf430e030ddbb5b0abf93d22962f4752f3646cd9` (commit
  7 Oct 2026). Both are at least 14 days old. Dates come from the tagged commits (`git fetch` of the tags),
  because the GitHub API was not open to this session.
- Lint: `actionlint` 1.7.12 with shellcheck 0.9.0, clean on every workflow in the repo; Biome clean.
- Tested locally: the `sign` and `summary` steps' own scripts, extracted from the YAML, were run against the built
  APK, both with no secrets (debug-signed, `not-release-signed`) and with the build-check key as the four
  secrets. Both passed. The release-signed result's SHA-256 equals the hand-signed one. **Not run on GitHub**:
  pushing a branch does not trigger it, and dispatching it is outside this task's rules.

## Open items

1. **Size budget missed** on arm64-v8a (42.4 MB), x86_64 and x86 (44.9 MB); armeabi-v7a passes (33.1 MB). Likely
   fix: `useLegacyPackaging: true` (projected 22 to 25 MB per ABI, above). Other levers: drop the x86 ABIs from
   the shipped APK (`reactNativeArchitectures`; emulators only); the bundled ML Kit barcode scanner
   (`libbarhopper_v3`, 4.9 MB per ABI plus 0.9 MB of models) only if the pairing QR can use something lighter.
2. **JS bundle 5.4 MB of Hermes bytecode / 4.5 MB minified** against 3 MB. 641 KB of it is zod and contracts,
   pulled in through `@fairsplit/api-client` (WS-API plus the app's shim; see the findings above).
3. **`SYSTEM_ALERT_WINDOW`** in the release manifest (from the Expo template): add it to `blockedPermissions`.
4. **`docs/versions.md`** should record the two new action pins (a deps PR; this branch may not touch the file).
5. Run `android-apk.yml` once from `main` (or this branch) to prove it on a GitHub runner. Watch whether Maven
   Central rate-limits GitHub's runners too. If it does, the Google mirror trick in this report is the workaround
   (as an init script written into `$RUNNER_TEMP`).
6. Release builds take about 64 minutes here under load 15 to 40 with `--max-workers=2`. A runner (4 vCPU, nothing
   else running) should be faster; the job's timeout is 90 minutes.

## Decisions taken without the owner (safer option)

- No `app.config.ts` change. Neither `useLegacyPackaging` nor `SYSTEM_ALERT_WINDOW` was a build _failure_, and
  both change what ships, so both are recommendations.
- Maven Central's 429s were worked around only locally (an init script in scratch), not in the repo or the workflow.
- Signing in the workflow is by `apksigner` after the build rather than through Gradle `signingConfigs`: no config
  plugin, nothing in the generated project to edit, and the same steps run locally and on GitHub.
- The workflow release-signs on any ref it is dispatched from, as the handoff asks. If release keys are added,
  consider a protected environment limited to `main` (as `sandbox-smoke.yml` does).
- The throwaway key is valid for 30 days, PKCS12, password generated randomly into a 0600 file in scratch, and
  never printed. The hashes above are of build-check-signed files and mean nothing for a release key.
- Processes were stopped only by PID after checking they were this session's (an earlier `pkill` by pattern was
  refused by the sandbox, rightly: it could have hit other agents' Gradle processes).
