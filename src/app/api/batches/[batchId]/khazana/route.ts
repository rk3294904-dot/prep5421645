import { NextRequest, NextResponse } from "next/server";
import { apiGet, TTL, resolveAssetUrl } from "@/lib/study-api";

export const dynamic = "force-dynamic";

type KhazanaResponse = {
  data?:
    | {
        _id?: string;
        name?: string;
        topics?: {
          _id?: string;
          name?: string;
          videos?: {
            _id?: string;
            name?: string;
            videoId?: string;
            videoDetails?: { name?: string; image?: string; duration?: string };
            contentId?: string;
          }[];
          notes?: {
            _id?: string;
            name?: string;
            url?: string;
            baseUrl?: string;
            path?: string;
          }[];
        }[];
        subjects?: { _id?: string; name?: string; topics?: unknown[] }[];
      }[]
    | null;
};

/** GET /api/batches/:batchId/khazana — treasure vault content (best effort). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await params;

  const variants = [
    `/khazana-service/v1/khazana/batches/${batchId}`,
    `/v1/khazana/batches/${batchId}`,
    `/khazana-service/v1/khazana/subjects?batchId=${batchId}`,
  ];

  for (const path of variants) {
    const res = await apiGet<KhazanaResponse>(path, { ttl: TTL.misc, timeoutMs: 15000 });
    const arr = Array.isArray(res.data?.data)
      ? res.data!.data!
      : Array.isArray(res.data)
        ? res.data
        : null;
    if (arr && arr.length > 0) {
      const groups = arr.map((g) => ({
        id: g._id ?? "",
        name: g.name ?? "Khazana",
        topics: (g.topics ?? []).map((t) => ({
          id: t._id ?? "",
          name: t.name ?? "",
          videos: (t.videos ?? []).map((v) => ({
            id: v._id ?? v.contentId ?? "",
            name: v.videoDetails?.name ?? v.name ?? "Video",
            videoId: v.videoId ?? "",
            thumbnail: v.videoDetails?.image ?? "",
            duration: v.videoDetails?.duration ?? "",
          })),
          notes: (t.notes ?? []).map((n) => ({
            id: n._id ?? "",
            name: n.name ?? "Note",
            url: resolveAssetUrl(n.path ?? n.url ?? "", n.baseUrl || "https://static.pw.live/"),
          })),
        })),
      }));
      return NextResponse.json({ success: true, khazana: groups });
    }
  }

  return NextResponse.json({ success: true, khazana: [] });
}
