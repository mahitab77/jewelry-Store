import { publicPhotograph } from "../../../lib/media/delivery.ts";
export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) { return publicPhotograph((await params).id); }
