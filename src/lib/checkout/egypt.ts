// Controlled destinations, not a claim of delivery coverage or availability.
export const governorates = ["Alexandria", "Aswan", "Asyut", "Beheira", "Beni Suef", "Cairo", "Dakahlia", "Damietta", "Fayoum", "Gharbia", "Giza", "Ismailia", "Kafr El Sheikh", "Luxor", "Matrouh", "Minya", "Monufia", "New Valley", "North Sinai", "Port Said", "Qalyubia", "Qena", "Red Sea", "Sharqia", "Sohag", "South Sinai", "Suez"] as const;
export function egyptianMobile(value: string): string | null {
  let phone = value.normalize("NFKC").replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) - (digit >= "۰" ? 0x6f0 : 0x660))).trim();
  if (!/^[+0-9 ()-]+$/.test(phone)) return null;
  phone = phone.replace(/[ ()-]/g, "");
  if (phone.startsWith("0020")) phone = "+" + phone.slice(2);
  else if (phone.startsWith("0")) phone = "+20" + phone.slice(1);
  return /^\+201[0125][0-9]{8}$/.test(phone) ? phone : null;
}
