import { describe, expect, it } from "vitest";
import { exhibitDefines, previewMediaHandler } from "../scripts/exhibit-data.js";

describe("public reading-room build data", () => {
  it("inv.i8.exhibit-source: derives ten readings and twelve labelled images from committed evidence", () => {
    const defs = exhibitDefines();
    const report = JSON.parse(defs.__FS_EXHIBIT_REPORT__);
    const media = JSON.parse(defs.__FS_EXHIBIT_MEDIA__);
    expect(report.cases).toHaveLength(10);
    expect(Object.keys(media.compositions)).toHaveLength(12);
    expect(media.compositions.A.label).toBe("Code-composed · synthetic");
    expect(
      report.cases.find((entry: { id: string }) => entry.id === "spike-0462").rows[0].fields.net_kg.a
        .value_text,
    ).toBe("6?.50");
    expect(report).not.toHaveProperty("cost");
    expect(report).not.toHaveProperty("registry");
    expect(media.assets["spike-0462"]).not.toHaveProperty("attempts");
  });

  it("inv.i8.preview-media: mock preview serves only committed hero and A–L WebP images", () => {
    const handler = previewMediaHandler();
    const headers: Record<string, string> = {};
    let bytes: Buffer | undefined;
    let passed = 0;
    const response = {
      setHeader: (key: string, value: string) => {
        headers[key] = value;
      },
      end: (body: Buffer) => {
        bytes = body;
      },
    };
    handler({ url: "/media/photos/A.webp" }, response, () => {
      passed++;
    });
    expect(headers["content-type"]).toBe("image/webp");
    expect(bytes?.subarray(0, 4).toString()).toBe("RIFF");
    expect(passed).toBe(0);
    for (const url of [
      "/media/manifest.json",
      "/media/../.env",
      "/media/raw/slip.png",
      "/media/photos/P01.webp",
    ]) {
      handler({ url }, response, () => {
        passed++;
      });
    }
    expect(passed).toBe(4);
  });
});
