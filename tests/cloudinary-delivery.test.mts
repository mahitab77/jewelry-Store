import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import sharp from "sharp";
import { cloudinaryProvider, deliveryUrl, preparePhoto, type ProviderAsset } from "../src/lib/media/cloudinary.ts";
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

const uploadInput = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#246444" } }).png().toBuffer();
const uploadPhoto = await preparePhoto(uploadInput, "image/png");
for (const format of ["jpg", "png", "webp"] as const) {
  test(`authenticated ${format} upload sets only the asset folder; public ID and SDK delivery URL stay unchanged`, async () => {
    const input = await sharp(uploadInput).toFormat(format === "jpg" ? "jpeg" : format).toBuffer();
    const mime = format === "jpg" ? "image/jpeg" : `image/${format}`;
    const photo = await preparePhoto(input, mime), mock = cloudinaryMock();
    const provider = cloudinaryProvider(mockCloudinaryConfiguration, async (url, init) => {
      const request = new Request(url, init), form = await request.formData();
      assert.ok(request.url.endsWith("/image/authenticated"));
      assert.equal(request.method, "POST");
      assert.equal(request.headers.get("authorization"), "Basic " + Buffer.from(`${mockCloudinaryConfiguration.apiKey}:${mockCloudinaryConfiguration.apiSecret}`).toString("base64"));
      assert.deepEqual(new Set(form.keys()), new Set(["file", "public_id", "overwrite", "unique_filename", "asset_folder"]));
      assert.equal(form.get("asset_folder"), "la-palme/catalogue");
      assert.equal(form.get("public_id"), original.publicId);
      const file = form.get("file"); assert.ok(file instanceof File);
      assert.equal(file.name, `photograph.${format}`); assert.equal(file.type, mime);
      assert.deepEqual(new Uint8Array(await file.arrayBuffer()), photo.bytes);
      const response = await mock.fakeFetch(url, init);
      assert.equal((await response.clone().json()).asset_folder, "la-palme/catalogue");
      return response;
    });
    const uploaded = await provider.upload(original.publicId, photo);
    assert.equal(uploaded.publicId, original.publicId);
    assert.equal(deliveryUrl(mockCloudinaryConfiguration, uploaded), fixture.vectors.find((v) => v.publicId === original.publicId && v.format === format)!.expectedUrl);
    assert.equal(mock.assets.size, 1);
  });
}

const badForms: [string, (form: FormData) => void][] = [
  ["missing folder", (form) => form.delete("asset_folder")],
  ["empty folder", (form) => form.set("asset_folder", "")],
  ["unrelated folder", (form) => form.set("asset_folder", "unrelated")],
  ["product subfolder", (form) => form.set("asset_folder", original.publicId)],
  ["duplicate folder field", (form) => form.append("asset_folder", "la-palme/catalogue")],
  ["public ID prefix", (form) => form.set("public_id_prefix", "la-palme/catalogue")],
  ["automatic folder prefix", (form) => form.set("use_asset_folder_as_public_id_prefix", "true")],
  ["upload preset", (form) => form.set("upload_preset", "unreviewed")],
];
for (const [name, alter] of badForms) {
  test(`provider mock rejects incorrect folder parameters: ${name}`, async () => {
    const mock = cloudinaryMock();
    const provider = cloudinaryProvider(mockCloudinaryConfiguration, async (url, init) => {
      const form = await new Request(url, init).formData(); alter(form);
      return mock.fakeFetch(url, { ...init, body: form });
    });
    await assert.rejects(provider.upload(original.publicId, uploadPhoto), CatalogueAdminError);
    assert.equal(mock.assets.size, 0);
  });
}
for (const publicId of ["unrelated/asset", original.publicId + "/extra", "la-palme/catalogue/" + original.publicId]) {
  test(`invalid upload namespace is rejected before provider I/O: ${publicId}`, async () => {
    let calls = 0;
    const provider = cloudinaryProvider(mockCloudinaryConfiguration, async () => { calls++; throw new Error("Unexpected network request"); });
    await assert.rejects(provider.upload(publicId, uploadPhoto), CatalogueAdminError);
    assert.equal(calls, 0);
  });
}
for (const [field, value] of Object.entries({ public_id: "unrelated/asset", type: "upload", resource_type: "video", format: "gif", width: 1, height: 1, bytes: 0, asset_id: "bad", signature: "bad" })) {
  test(`folder-aware upload still rejects malformed provider response: ${field}`, async () => {
    const mock = cloudinaryMock();
    const provider = cloudinaryProvider(mockCloudinaryConfiguration, async (url, init) => {
      const response = await mock.fakeFetch(url, init);
      return Response.json({ ...await response.json(), [field]: value });
    });
    await assert.rejects(provider.upload(original.publicId, uploadPhoto), CatalogueAdminError);
  });
}
