import { NextRequest, NextResponse } from "next/server";
import { apiGet, TTL, resolveAssetUrl } from "@/lib/study-api";

export const dynamic = "force-dynamic";

type AnnouncementsResponse = {
  data?:
    | {
        _id?: string;
        description?: string;
        createdAt?: string;
        updatedAt?: string;
        attachments?: { baseUrl?: string; id?: string; fileName?: string; name?: string }[];
      }[]
    | null;
};

/** GET /api/batches/:batchId/announcements — try known upstream variants. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await params;

  const variants = [
    `/v2/announcements?batchId=${batchId}`,
    `/v1/batches/${batchId}/announcements`,
    `/v2/batches/${batchId}/announcement?page=1`,
    `/v2/announcements?batchId=${batchId}&page=1&limit=20`,
  ];

  for (const path of variants) {
    const res = await apiGet<AnnouncementsResponse>(path, { ttl: TTL.misc, timeoutMs: 15000 });
    const arr = Array.isArray(res.data?.data)
      ? res.data!.data!
      : Array.isArray(res.data)
        ? res.data
        : null;
    if (arr && arr.length > 0) {
      return NextResponse.json({
        success: true,
        announcements: arr.map((a, i) => ({
          id: a._id ?? `ann-${i}`,
          description: a.description ?? "",
          createdAt: a.createdAt ?? a.updatedAt ?? "",
          attachments: (a.attachments ?? [])
            .map((at) => ({
              name: at.fileName ?? at.name ?? "Attachment",
              url: resolveAssetUrl(at.id ?? "", at.baseUrl || "https://static.pw.live/"),
            }))
            .filter((at) => at.url),
        })),
      });
    }
  }

  return NextResponse.json({ success: true, announcements: [] });
}
