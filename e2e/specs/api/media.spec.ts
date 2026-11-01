import { expect, test } from "../../lib/fixtures.js";

test("the stack serves the curated photos and slips the console uses", async ({ request }) => {
  for (const url of ["/media/photos/A.webp", "/media/slips/spike-0403.webp"]) {
    const response = await request.get(url);
    expect(response.status(), url).toBe(200);
    expect(response.headers()["content-type"], url).toMatch(/^image\/webp(?:;|$)/);
    expect((await response.body()).length, url).toBeGreaterThan(0);
  }
});
