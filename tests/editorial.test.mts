import assert from "node:assert/strict";
import { test } from "node:test";
import { businessContact, confirmedContactMethods } from "../src/lib/editorial/contact.ts";

test("unconfirmed and missing contact methods never become active links", () => {
  assert.equal(businessContact.emailConfirmed, false);
  assert.deepEqual(confirmedContactMethods(), []);
  assert.deepEqual(confirmedContactMethods({ locality: "Cairo, Egypt", emailConfirmed: true }), []);
  assert.deepEqual(confirmedContactMethods({ locality: "Cairo, Egypt", email: "unconfirmed@boutique.test", emailConfirmed: false }), []);
});

test("an explicitly confirmed address produces an encoded mailto without submitting anything", () => {
  const methods = confirmedContactMethods({ locality: "Cairo, Egypt", email: "studio+enquiries@boutique.test", emailConfirmed: true });
  assert.deepEqual(methods, [{ label: "studio+enquiries@boutique.test", href: "mailto:studio%2Benquiries@boutique.test" }]);
});

test("malformed or injected contact values do not become mailto links", () => {
  for (const email of ["", "YOUR_EMAIL", "not-an-address", "a@boutique.test?subject=Injected", "a@boutique.test\r\nBcc:other@boutique.test", "javascript:alert(1)"]) {
    assert.deepEqual(confirmedContactMethods({ locality: "Cairo, Egypt", email, emailConfirmed: true }), []);
  }
});
