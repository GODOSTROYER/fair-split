// Build-time constants defined by vite.config.ts and vitest.config.ts.

/** The data source this build answers from: "mock" (msw over the seed) or "http" (fs-api). */
declare const __FS_DATA__: "mock" | "http";
declare const __FS_EXHIBIT_REPORT__: import("./features/reading/exhibits.js").RecordingReport;
declare const __FS_EXHIBIT_MEDIA__: import("./features/reading/exhibits.js").ExhibitMedia;
