# Cloud T4: Android APK build on Linux

Branch `cloud/apk-linux`, cut from `origin/main` at `3e1ec112`. Handoff task T4 (`docs/handoff/cloud.md` on
`cloud/handoff`). Status: **in progress** (build running).

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

Pending.
