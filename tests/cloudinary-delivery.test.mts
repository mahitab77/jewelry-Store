import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { cloudinaryProvider, deliveryUrl, type ProviderAsset } from "../src/lib/media/cloudinary.ts";
import { CatalogueAdminError } from "../src/lib/admin/catalogue/validation.ts";
import { cloudinaryMock, mockCloudinaryConfiguration } from "./helpers/cloudinary-mock.mts";

// Literal outputs of the official SDK, not calculated by the app or provider mock.
// Regenerate outside the repository with cloudinary@2.11.0 utils.url(publicId,
// { ...fixture.options, cloud_name: mock.cloudName, api_secret: mock.apiSecret,
//   format, version }); no SDK dependency or network call is needed by these tests.
const fixture = JSON.parse(await readFile(new URL("./fixtures/cloudinary-delivery-signatures.json", import.meta.url), "utf8")) as {
  verifiedVersions: string[];
  vectors: { publicId: string; format: ProviderAsset["format"]; expectedUrl: string }[];
};
const photograph = new Uint8Array([1, 2, 3]);
function asset(publicId: string, format: ProviderAsset["format"], version: string): ProviderAsset {
  return { publicId, format, version, assetId: "synthetic-vector-asset", width: 300, height: 300, bytes: photograph.length };
}

for (const [index, vector] of fixture.vectors.entries()) {
  for (const version of fixture.verifiedVersions) {
    test(`official SDK delivery vector ${index + 1}: ${vector.format}, version ${version}`, async () => {
      const stored = asset(vector.publicId, vector.format, version);
      const expected = vector.expectedUrl.replace("/v1/", `/v${version}/`);
      assert.equal(deliveryUrl(mockCloudinaryConfiguration, stored), expected);
      const url = new URL(expected);
      assert.equal(url.origin, "https://res.cloudinary.com");
      assert.equal(url.search, "");
      assert.ok(!expected.includes(mockCloudinaryConfiguration.apiSecret));
      assert.ok(!expected.includes(mockCloudinaryConfiguration.apiKey));

      // Bind the dynamic provider mock to the same independent SDK outputs.
      const mock = cloudinaryMock();
      mock.assets.set(stored.publicId, { asset: stored, bytes: photograph });
      assert.equal((await mock.fakeFetch(expected)).status, 200);
      const delivered = await cloudinaryProvider(mockCloudinaryConfiguration, mock.fakeFetch).read(stored);
      assert.deepEqual(delivered.bytes, photograph);
      assert.equal(delivered.contentType, vector.format === "jpg" ? "image/jpeg" : `image/${vector.format}`);
      const tampered = expected.replace(/\/s--./, "/s--!");
      assert.equal((await mock.fakeFetch(tampered)).status, 404);
    });
  }
}

const original = asset(fixture.vectors[0].publicId, "jpg", "1");
const malformed: [string, Partial<ProviderAsset>][] = [
  ["foreign namespace", { publicId: original.publicId.replace("la-palme/catalogue", "other/catalogue") }],
  ["remote URL", { publicId: "https://example.invalid/photo.jpg" }],
  ["path traversal", { publicId: original.publicId.replace("/catalogue/", "/catalogue/../") }],
  ["extra folder", { publicId: original.publicId + "/extra" }],
  ["query string", { publicId: original.publicId + "?download=1" }],
  ["fragment", { publicId: original.publicId + "#photo" }],
  ["missing public ID", { publicId: undefined }],
  ["zero version", { version: "0" }],
  ["leading-zero version", { version: "01" }],
  ["negative version", { version: "-1" }],
  ["decimal version", { version: "1.5" }],
  ["prefixed version", { version: "v1" }],
  ["oversized version", { version: "10000000000000000" }],
  ["version path", { version: "1/other" }],
  ["missing version", { version: undefined }],
  ["unsupported format", { format: "svg" as ProviderAsset["format"] }],
  ["format path", { format: "jpg/other" as ProviderAsset["format"] }],
  ["missing format", { format: undefined }],
];
for (const [name, patch] of malformed) {
  test(`malformed delivery metadata is rejected before provider I/O: ${name}`, async () => {
    const stored = { ...original, ...patch } as ProviderAsset;
    assert.throws(() => deliveryUrl(mockCloudinaryConfiguration, stored), CatalogueAdminError);
    let calls = 0;
    const provider = cloudinaryProvider(mockCloudinaryConfiguration, async () => { calls++; throw new Error("Unexpected network request"); });
    await assert.rejects(provider.read(stored), CatalogueAdminError);
    assert.equal(calls, 0);
  });
}
