export const requestKinds = ["QUOTATION", "MODIFICATION", "BESPOKE", "CONSULTATION"] as const;
export type RequestKind = typeof requestKinds[number];
export type ConsultationChannel = "ZOOM" | "BOUTIQUE";
export interface PublicRequestInput {
  submissionId: string; kind: RequestKind; productId?: string; variantId?: string;
  name: string; email?: string; phone?: string; message: string;
  channel?: ConsultationChannel; preferredDate?: string; preferredTime?: string;
}
export interface ProductContext {
  name: string; slug: string; sku: string | null; size: string | null; configuration: string | null;
  metalType: string | null; metalPurity: string | null; metalColor: string | null;
  metalWeightGrams: string | null; metalWeightBasis: "ACTUAL" | "ESTIMATED" | null;
  stones: { type: string; variety: string | null; shape: string; color: string; caratWeight: string | null; totalCaratWeight: string | null; quantity: number; role: "CENTER" | "ACCENT" | "OTHER" }[];
}
export const requestStatuses: Record<RequestKind, readonly string[]> = {
  QUOTATION: ["NEW", "CONTACTED", "RESOLVED", "CLOSED"],
  MODIFICATION: ["NEW", "CONTACTED", "IN_DESIGN", "QUOTED", "ACCEPTED", "CLOSED", "CANCELLED"],
  BESPOKE: ["NEW", "CONTACTED", "IN_DESIGN", "QUOTED", "ACCEPTED", "CLOSED", "CANCELLED"],
  CONSULTATION: ["NEW", "CONTACTED", "CONFIRMED", "DECLINED", "CANCELLED", "COMPLETED"],
};
export function nextStatuses(kind: RequestKind, status: string): readonly string[] {
  const quotation: Record<string, string[]> = { NEW: ["CONTACTED", "CLOSED"], CONTACTED: ["RESOLVED", "CLOSED"], RESOLVED: ["CONTACTED", "CLOSED"] };
  const bespoke: Record<string, string[]> = { NEW: ["CONTACTED", "CLOSED", "CANCELLED"], CONTACTED: ["IN_DESIGN", "QUOTED", "CLOSED", "CANCELLED"], IN_DESIGN: ["CONTACTED", "QUOTED", "CLOSED", "CANCELLED"], QUOTED: ["CONTACTED", "IN_DESIGN", "ACCEPTED", "CLOSED", "CANCELLED"], ACCEPTED: ["CLOSED", "CANCELLED"] };
  const consultation: Record<string, string[]> = { NEW: ["CONTACTED", "CONFIRMED", "DECLINED", "CANCELLED"], CONTACTED: ["CONFIRMED", "DECLINED", "CANCELLED"], CONFIRMED: ["COMPLETED", "CANCELLED"] };
  return [status, ...((kind === "QUOTATION" ? quotation : kind === "CONSULTATION" ? consultation : bespoke)[status] ?? [])];
}
export interface AdminRequest {
  id: string; kind: RequestKind; status: string; name: string; email: string | null; phone: string | null; message: string;
  productId: string | null; variantId: string | null; productContext: ProductContext | null;
  channel: ConsultationChannel | null; preferredStart: string | null; confirmedStart: string | null;
  boutiqueLocationId: string | null; assignedAdminId: string | null; assignedName: string | null;
  revision: string; createdAt: string;
}
export interface RequestChoices { staff: { id: string; name: string }[]; locations: { id: string; name: string; governorate: string; city: string; street: string }[] }
export interface RequestList extends RequestChoices { items: AdminRequest[]; newCount: number; page: number; hasMore: boolean }
export interface RequestDetail extends RequestChoices { request: AdminRequest }
export interface RequestReceipt { reference: string; message: string }
