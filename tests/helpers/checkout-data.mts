import { emptyDetails } from "../../src/lib/checkout/types.ts";
export const checkoutContact = { fullName: "Checkout Fixture", email: "checkout-fixture@boutique.test", phone: "+201000000001" };
export const deliveryDetails = () => ({ ...emptyDetails(), ...checkoutContact, method: "PRIVATE_DELIVERY" as const, governorate: "Cairo", city: "Test area", street: "TEST ONLY street address", building: "Test building", floorUnit: "Test unit", instructions: "TEST ONLY instructions" });
export const testLocation = { name: "[TEST ONLY] Collection location", governorate: "Cairo", city: "Fixture area", street: "TEST ONLY location address" };
