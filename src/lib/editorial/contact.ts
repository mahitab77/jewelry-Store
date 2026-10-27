import "server-only";

export interface ContactInformation {
  locality: string;
  email?: string;
  emailConfirmed: boolean;
}

// The locality is established homepage copy. The owner has asked
// to keep the existing mailbox unconfirmed; do not publish it as an active link.
export const businessContact: Readonly<ContactInformation> = {
  locality: "Cairo, Egypt",
  email: "contact@lapalmedorgems.com",
  emailConfirmed: false,
};

export function confirmedContactMethods(contact: ContactInformation = businessContact): { label: string; href: string }[] {
  if (!contact.emailConfirmed || !contact.email || contact.email.length > 254 ||
    !/^[A-Z0-9][A-Z0-9._+-]*@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i.test(contact.email)) return [];
  return [{ label: contact.email, href: `mailto:${encodeURIComponent(contact.email).replace("%40", "@")}` }];
}
