"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/lib/store";
import {
  GlassBadge,
  GlassButton,
  GlassCard,
  GlassSkeleton,
  SafeImage,
} from "./glass";
import {
  ArrowLeft,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Gauge,
  Settings2,
  FileText,
  ListVideo,
  Loader2,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  SkipBack,
  SkipForward,
  ShieldCheck,
  Youtube,
  Clock,
  MonitorPlay,
  Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { lxpwWatchUrl } from "@/lib/study-api";
import { firebaseAuth, recordLectureProgress } from "@/lib/firebase";

interface PlaylistLecture {
  id: string;
  title: string;
  thumbnail?: string;
  duration?: string;
  isLocked?: boolean;
}

interface NoteDoc {
  id: string;
  name: string;
  url: string;
}

interface StreamResolution {
  playable: boolean;
  kind: "mp4" | "hls" | "dash" | "unknown";
  url: string;
  reason?: string;
  folder?: string;
  engine?: "hls" | "dash" | "native";
  manifestVia?: string;
  clearKey?: string;
  clearKid?: string;
  sig?: string;
  title?: string;
  duration?: string;
}

/* ------------------------- YouTube IFrame API loader ------------------------- */

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: {
          videoId: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (e: { target: YTPlayer }) => void;
            onStateChange?: (e: { data: number; target: YTPlayer }) => void;
            onError?: () => void;
          };
        }
      ) => YTPlayer;
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number; UNSTARTED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(sec: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setVolume(v: number): void;
  getVolume(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setPlaybackRate(r: number): void;
  getAvailablePlaybackRates(): number[];
  getPlaybackQuality(): string;
  setPlaybackQuality(q: string): void;
  getAvailableQualityLevels(): string[];
  loadVideoById(o: { videoId: string }): void;
  destroy(): void;
  getIframe(): HTMLIFrameElement;
}

type YouTubeApi = NonNullable<Window["YT"]>;

let ytApiPromise: Promise<YouTubeApi> | null = null;

function loadYouTubeApi(): Promise<YouTubeApi> {
  if (typeof window === "undefined") return Promise.reject("no window");
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

/* --------------------------------- component --------------------------------- */

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function WatchView({
  batchId,
  subjectSlug,
  topicId,
  contentId,
  playerOnly = false,
}: {
  batchId: string;
  subjectSlug: string;
  topicId?: string;
  contentId: string;
  playerOnly?: boolean;
}) {
  const { navigate, back } = useApp();
  const appState = useApp();

  const [videoId, setVideoId] = useState<string | undefined>(appState.videoId || undefined);
  const [urlType, setUrlType] = useState<string>("youtube");
  const [stream, setStream] = useState<StreamResolution | null>(null);
  const [resolving, setResolving] = useState(false);
  const [title, setTitle] = useState(appState.lectureTitle ?? "");
  const [thumbnail, setThumbnail] = useState("");
  const [notes, setNotes] = useState<NoteDoc[]>([]);
  const [playlist, setPlaylist] = useState<PlaylistLecture[]>([]);
  const [loading, setLoading] = useState(!appState.videoId);
  const [bookmarkSet, setBookmarkSet] = useState(false);
  /** "embed" = LearnX PW player iframe (default for PW streams) · "native" = in-app engine */
  const [playerMode, setPlayerMode] = useState<"embed" | "native">(
    (appState.videoType ?? "youtube") === "youtube" ? "native" : "embed"
  );

  /* ----------------------------- fetch detail ----------------------------- */
  useEffect(() => {
    let alive = true;
    fetch(
      `/api/batches/${batchId}/subjects/${encodeURIComponent(subjectSlug)}/schedule/${contentId}`
    )
      .then((r) => r.json())
      .then(async (d) => {
        if (!alive || !d?.success) {
          if (alive) setLoading(false);
          return;
        }
        const lec = d.lecture ?? {};
        if (lec.title) setTitle(lec.title);
        if (lec.thumbnail) setThumbnail(lec.thumbnail);
        setNotes(d.notes ?? []);
        const type = (lec.urlType ?? "youtube").toLowerCase();
        setUrlType(type);
        setPlayerMode(type === "youtube" ? "native" : "embed");
        if (type === "youtube") {
          if (lec.videoId || lec.videoUrl) setVideoId(lec.videoId ?? lec.videoUrl);
          setLoading(false);
        } else {
          // Non-YouTube lecture — render the PW embed player right away and
          // resolve the native stream in the background for the toggle.
          setVideoId(undefined);
          setResolving(false);
          setLoading(false);
          const apiId = lec.videoApiId ?? lec.videoId ?? "";
          if (apiId) {
            const q = lec.videoUrl ? `?url=${encodeURIComponent(lec.videoUrl)}` : "";
            fetch(`/api/streams/${encodeURIComponent(apiId)}${q}`)
              .then((r) => r.json())
              .then((sj) => {
                if (alive) setStream({ ...sj, playable: !!sj.playable });
              })
              .catch(() => {
                if (alive)
                  setStream({ playable: false, kind: "unknown", url: "", reason: "Could not resolve stream." });
              });
          } else if (alive) {
            setStream({ playable: false, kind: "unknown", url: "", reason: "No stream attached yet." });
          }
        }
      })
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [batchId, subjectSlug, contentId]);

  /* ------------------------------ playlist -------------------------------- */
  useEffect(() => {
    if (!topicId) return;
    let alive = true;
    fetch(
      `/api/batches/${batchId}/subjects/${encodeURIComponent(subjectSlug)}/contents?contentType=videos&tag=${encodeURIComponent(topicId)}&pages=6`
    )
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setPlaylist(
          (d?.items ?? []).map((x: PlaylistLecture) => ({
            id: x.id,
            title: x.title,
            thumbnail: x.thumbnail,
            duration: x.duration,
            isLocked: x.isLocked,
          }))
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [batchId, subjectSlug, topicId]);

  /* ------------------------------ bookmark -------------------------------- */
  useEffect(() => {
    let alive = true;
    fetch("/api/bookmarks")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setBookmarkSet((d?.items ?? []).some((b: { contentId: string }) => b.contentId === contentId));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [contentId]);

  const toggleBookmark = async () => {
    const res = await fetch("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "lecture",
        contentId,
        batchId,
        batchName: appState.batchName ?? "",
        subjectName: appState.subjectName ?? "",
        title,
        subtitle: appState.topicName ?? "",
        url: videoId,
        urlType: urlType === "youtube" ? "youtube" : stream?.kind ?? "hls",
        thumbnail: "",
      }),
    });
    const d = await res.json();
    if (d?.success) setBookmarkSet(d.bookmarked);
  };

  /* --------------------------- history tracking --------------------------- */
  const savePosition = useCallback(
    (pos: number) => {
      fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId,
          batchName: appState.batchName ?? "",
          batchImage: appState.batchImage ?? "",
          subjectId: subjectSlug,
          subjectName: appState.subjectName ?? prettify(subjectSlug),
          subjectSlug,
          topicId,
          topicName: appState.topicName ?? "",
          contentId,
          lectureTitle: title,
          videoId,
          videoType: urlType === "youtube" ? "youtube" : stream?.kind ?? "hls",
          positionSec: Math.floor(pos),
        }),
      }).catch(() => {});
      const user = firebaseAuth.currentUser;
      const minute = Math.floor(pos / 60);
      if (user && minute > leaderboardMinuteRef.current) {
        leaderboardMinuteRef.current = minute;
        recordLectureProgress({
          userId: user.uid,
          userName: user.displayName ?? "Learner",
          photoURL: user.photoURL,
          batchId,
          contentId,
          seconds: pos,
        }).catch(() => {});
      }
    },
    [batchId, subjectSlug, topicId, contentId, title, videoId, urlType, stream, appState.batchName, appState.batchImage, appState.subjectName, appState.topicName]
  );

  /* ------------------- embed-mode history ping (once) -------------------- */
  const historyInitRef = useRef<string | null>(null);
  const leaderboardMinuteRef = useRef(-1);
  useEffect(() => {
    if (playerMode === "embed" && historyInitRef.current !== contentId) {
      historyInitRef.current = contentId;
      savePosition(0);
    }
  }, [playerMode, contentId, savePosition]);

  if (playerOnly && !videoId && (loading || resolving)) {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-black p-3 sm:p-8">
        <GlassSkeleton className="aspect-video w-full max-w-6xl" />
      </main>
    );
  }

  if (playerOnly) {
    return (
      <main className="fixed inset-0 flex min-h-screen min-w-full items-center justify-center overflow-hidden bg-black p-3 sm:p-6">
        <div className="mx-auto w-full max-w-[1500px]">
          {videoId ? (
            playerMode === "embed" ? (
              <EmbedPlayer
                batchId={batchId}
                subjectSlug={subjectSlug}
                contentId={contentId}
                urlType={urlType}
                videoId={videoId}
              />
            ) : (
              <PremiumPlayer videoId={videoId} onProgress={(t) => savePosition(t)} />
            )
          ) : playerMode === "embed" ? (
            <EmbedPlayer
              batchId={batchId}
              subjectSlug={subjectSlug}
              contentId={contentId}
              urlType={urlType}
            />
          ) : stream?.playable ? (
            <AvPlayer stream={stream} onProgress={(t) => savePosition(t)} />
          ) : (
            <SecuredStreamPanel title={title} thumbnail={thumbnail} stream={stream} />
          )}
        </div>
      </main>
    );
  }

  if (!videoId && (loading || resolving)) {
    return (
      <main className="flex-1 w-full px-3 sm:px-5">
        <div className="mx-auto max-w-7xl pt-6 space-y-4">
          <GlassSkeleton className="aspect-video max-w-4xl" />
          <GlassSkeleton className="h-8 w-2/3 max-w-xl" />
        </div>
      </main>
    );
  }

  if (!videoId) {
    // Non-YouTube lecture — either a playable direct stream or a secured one
    return (
      <main className="flex-1 w-full px-3 sm:px-5">
        <div className="mx-auto max-w-7xl pt-6 pb-8 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <GlassButton variant="glass" size="sm" onClick={back} className="shrink-0">
              <ChevronLeft size={15} /> Back to chapter
            </GlassButton>
            <PlayerModeToggle mode={playerMode} onChange={setPlayerMode} />
          </div>
          <div className="grid gap-5 grid-cols-1 xl:grid-cols-[1fr_360px]">
            <div className="space-y-4 min-w-0">
              {playerMode === "embed" ? (
                <EmbedPlayer
                  batchId={batchId}
                  subjectSlug={subjectSlug}
                  contentId={contentId}
                  urlType={urlType}
                  videoId={videoId}
                />
              ) : stream?.playable ? (
                <AvPlayer stream={stream} onProgress={(t) => savePosition(t)} />
              ) : (
                <SecuredStreamPanel
                  title={title}
                  thumbnail={thumbnail}
                  stream={stream}
                />
              )}
              <GlassCard hover={false} className="p-5 sm:p-6">
                <h1 className="text-lg sm:text-2xl font-extrabold tracking-tight leading-snug">{title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {appState.batchName && (
                    <button className="cursor-pointer" onClick={() => navigate({ view: "batch", batchId })}>
                      <GlassBadge tone="gold">{appState.batchName}</GlassBadge>
                    </button>
                  )}
                  {appState.subjectName && <GlassBadge>{appState.subjectName}</GlassBadge>}
                  {appState.topicName && <GlassBadge>{appState.topicName}</GlassBadge>}
                </div>
              </GlassCard>
              <GlassCard hover={false} className="p-5 sm:p-6">
                <h2 className="flex items-center gap-2 font-bold">
                  <FileText size={17} className="text-[#f5b52e]" /> Attached Notes & DPPs
                </h2>
                {notes.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">No notes attached to this lecture.</p>
                ) : (
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {notes.map((n) => (
                      <a
                        key={n.id}
                        href={n.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 rounded-2xl glass-soft px-4 py-3 group"
                      >
                        <span className="w-10 h-10 rounded-xl glass flex items-center justify-center text-[#f5b52e] shrink-0">
                          <FileText size={17} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold line-clamp-1 group-hover:text-[#f8d477] transition-colors">
                            {n.name}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">PDF · opens in new tab</span>
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </GlassCard>
            </div>
            <aside className="min-w-0">
              <PlaylistCard
                playlist={playlist}
                contentId={contentId}
                onOpen={(p) =>
                  navigate({
                    view: "watch",
                    batchId,
                    subjectSlug,
                    topicId,
                    contentId: p.id,
                    lectureTitle: p.title,
                  })
                }
              />
            </aside>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 w-full px-3 sm:px-5">
      <div className="mx-auto max-w-[1400px] pt-6 pb-8 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <GlassButton variant="glass" size="sm" onClick={back} className="shrink-0">
            <ChevronLeft size={15} /> Back to chapter
          </GlassButton>
          <PlayerModeToggle mode={playerMode} onChange={setPlayerMode} />
        </div>

        <div className={cn("grid gap-5", "grid-cols-1 xl:grid-cols-[1fr_360px]")}>
          {/* player column */}
          <div className="space-y-4 min-w-0">
            {playerMode === "embed" ? (
              <EmbedPlayer
                batchId={batchId}
                subjectSlug={subjectSlug}
                contentId={contentId}
                urlType={urlType}
                videoId={videoId}
              />
            ) : (
              <PremiumPlayer
                videoId={videoId}
                onProgress={(t) => savePosition(t)}
              />
            )}

            {/* meta row */}
            <GlassCard hover={false} className="p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h1 className="text-lg sm:text-2xl font-extrabold tracking-tight leading-snug">{title}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {appState.batchName && (
                      <button
                        className="cursor-pointer"
                        onClick={() => navigate({ view: "batch", batchId })}
                      >
                        <GlassBadge tone="gold">{appState.batchName}</GlassBadge>
                      </button>
                    )}
                    {appState.subjectName && <GlassBadge>{appState.subjectName}</GlassBadge>}
                    {appState.topicName && <GlassBadge>{appState.topicName}</GlassBadge>}
                  </div>
                </div>
                <GlassButton variant={bookmarkSet ? "gold" : "glass"} onClick={toggleBookmark}>
                  {bookmarkSet ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
                  {bookmarkSet ? "Saved" : "Save"}
                </GlassButton>
              </div>
            </GlassCard>

            {/* notes */}
            <GlassCard hover={false} className="p-5 sm:p-6">
              <h2 className="flex items-center gap-2 font-bold">
                <FileText size={17} className="text-[#f5b52e]" /> Attached Notes & DPPs
              </h2>
              {notes.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No notes attached to this lecture.</p>
              ) : (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {notes.map((n) => (
                    <a
                      key={n.id}
                      href={n.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 rounded-2xl glass-soft px-4 py-3 group"
                    >
                      <span className="w-10 h-10 rounded-xl glass flex items-center justify-center text-[#f5b52e] shrink-0">
                        <FileText size={17} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold line-clamp-1 group-hover:text-[#f8d477] transition-colors">
                          {n.name}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">PDF · opens in new tab</span>
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </GlassCard>
          </div>

          {/* playlist column */}
          <aside className="min-w-0">
            <PlaylistCard
              playlist={playlist}
              contentId={contentId}
              onOpen={(p) =>
                navigate({
                  view: "watch",
                  batchId,
                  subjectSlug,
                  topicId,
                  contentId: p.id,
                  lectureTitle: p.title,
                })
              }
            />
          </aside>
        </div>
      </div>
    </main>
  );
}

/* ---------------------- LearnX PW embed player ---------------------- */

/**
 * Embeds ONLY the video player of the LearnX PW mirror. Their /watch route is
 * a dedicated full-viewport player page (no sidebar, no site chrome, no
 * scrolling content) so the iframe shows exactly the player.
 */
function EmbedPlayer({
  batchId,
  subjectSlug,
  contentId,
  urlType,
  videoId,
}: {
  batchId: string;
  subjectSlug: string;
  contentId: string;
  urlType: string;
  videoId?: string;
}) {
  const src = lxpwWatchUrl({
    batchId,
    subjectSlug,
    contentId,
    urlType,
    youtubeId: videoId,
  });
  return (
    <div className="relative w-full aspect-video bg-black rounded-3xl overflow-hidden glass select-none">
      <iframe
        key={src}
        src={src}
        title="PW video player"
        className="absolute inset-0 w-full h-full border-0"
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

/** Segmented glass toggle between the PW embed player and the native engine. */
function PlayerModeToggle({
  mode,
  onChange,
}: {
  mode: "embed" | "native";
  onChange: (m: "embed" | "native") => void;
}) {
  return (
    <div
      className="glass-soft rounded-full p-1 flex gap-1 ml-auto"
      role="group"
      aria-label="Player mode"
    >
      <button
        onClick={() => onChange("embed")}
        aria-pressed={mode === "embed"}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-2.5 sm:px-3.5 h-8 text-[11px] sm:text-xs font-bold transition-all cursor-pointer whitespace-nowrap",
          mode === "embed" ? "btn-gold" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <MonitorPlay size={13} /> PW Player
      </button>
      <button
        onClick={() => onChange("native")}
        aria-pressed={mode === "native"}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-2.5 sm:px-3.5 h-8 text-[11px] sm:text-xs font-bold transition-all cursor-pointer whitespace-nowrap",
          mode === "native" ? "btn-gold" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Monitor size={13} /> Native Player
      </button>
    </div>
  );
}

/* ------------------------------ premium player ------------------------------ */

function PlaylistCard({
  playlist,
  contentId,
  onOpen,
}: {
  playlist: PlaylistLecture[];
  contentId: string;
  onOpen: (p: PlaylistLecture) => void;
}) {
  return (
    <GlassCard hover={false} className="overflow-hidden xl:sticky xl:top-24">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-white/8">
        <ListVideo size={17} className="text-[#f5b52e]" />
        <h2 className="font-bold text-sm">Chapter Playlist</h2>
        <span className="ml-auto text-xs text-muted-foreground">{playlist.length}</span>
      </div>
      <div className="max-h-[60vh] overflow-y-auto sb-scroll">
        {playlist.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground text-center">
            Playlist unavailable for this chapter.
          </p>
        ) : (
          playlist.map((p, i) => (
            <button
              key={p.id}
              onClick={() => onOpen(p)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer border-b border-white/5 last:border-0",
                p.id === contentId ? "bg-[#f5b52e]/10" : "hover:bg-white/5"
              )}
            >
              <span className={cn("text-[11px] font-bold w-5 shrink-0", p.id === contentId ? "text-[#f5b52e]" : "text-muted-foreground")}>
                {i + 1}
              </span>
              <span className="relative w-20 aspect-video rounded-lg overflow-hidden shrink-0 border border-white/10">
                <SafeImage src={p.thumbnail} alt="" className="w-full h-full object-cover" />
              </span>
              <span className={cn("min-w-0 flex-1 text-[13px] leading-snug line-clamp-2 font-medium", p.id === contentId && "text-[#f8d477]")}>
                {p.title}
              </span>
            </button>
          ))
        )}
      </div>
    </GlassCard>
  );
}

/** Honest fallback for lectures whose stream cannot be played in-app. */
function SecuredStreamPanel({
  title,
  thumbnail,
  stream,
}: {
  title: string;
  thumbnail?: string;
  stream: StreamResolution | null;
}) {
  return (
    <GlassCard hover={false} className="overflow-hidden">
      <div className="relative aspect-video bg-black">
        <SafeImage src={thumbnail} alt={title} className="w-full h-full object-cover opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <span className="w-16 h-16 rounded-3xl btn-glass flex items-center justify-center text-[#f5b52e]">
            <ShieldCheck size={26} />
          </span>
          <p className="mt-4 text-lg font-extrabold text-white">Secured studio stream</p>
          <p className="mt-1.5 max-w-md text-[13px] text-white/70 leading-relaxed">
            {stream?.reason ?? "This lecture streams from a protected CDN."} Notes and the
            chapter playlist are still available below.
          </p>
        </div>
      </div>
      <div className="p-5 flex flex-wrap items-center gap-3">
        <a
          href={`https://www.youtube.com/results?search_query=${encodeURIComponent(title)}`}
          target="_blank"
          rel="noreferrer"
        >
          <GlassButton variant="gold">
            <Youtube size={15} /> Find on YouTube
          </GlassButton>
        </a>
        <GlassBadge tone="neutral">
          <Clock size={10} /> VOD · hosted by the original platform
        </GlassBadge>
      </div>
    </GlassCard>
  );
}

/* ---------------------- AV engine player (HLS / DASH) ---------------------- */

interface QualityLevel {
  idx: number;
  label: string;
}

function uuidToB64url(uuid: string): string {
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hexToB64url(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function AvPlayer({
  stream,
  onProgress,
}: {
  stream: StreamResolution;
  onProgress?: (pos: number) => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{ destroy: () => void; currentLevel: number } | null>(null);
  const dashRef = useRef<{ destroy: () => void; reset: () => void } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriedRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [quality, setQuality] = useState("auto");
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [menu, setMenu] = useState<"none" | "speed" | "quality">("none");

  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  /** Autoplay with sound; falls back to muted start when the browser blocks it. */
  const tryAutoplay = useCallback((video: HTMLVideoElement) => {
    video.play().catch(() => {
      video.muted = true;
      setMuted(true);
      video.play().catch(() => {});
    });
  }, []);

  /* ------------------------- engine setup ------------------------- */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    setError(null);
    retriedRef.current = false;

    const setup = async () => {
      const engine = stream.engine ?? (stream.kind === "dash" ? "dash" : stream.kind === "hls" ? "hls" : "native");

      if (engine === "hls") {
        const mod = await import("hls.js");
        const Hls = mod.default;
        if (disposed) return;
        if (Hls.isSupported()) {
          const hls = new Hls({
            maxBufferLength: 24,
            maxMaxBufferLength: 60,
            backBufferLength: 30,
            enableWorker: true,
            lowLatencyMode: false,
          });
          hlsRef.current = hls;
          hls.loadSource(stream.url);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (disposed) return;
            setReady(true);
            setBuffering(false);
            setLevels(
              hls.levels.map((l, idx) => ({ idx, label: l.height ? `${l.height}p` : `${Math.round((l.bitrate ?? 0) / 1000)}k` }))
            );
            tryAutoplay(video);
          });
          hls.on(Hls.Events.LEVEL_SWITCHED, (_e, d) => {
            const l = hls.levels[d.level];
            if (l?.height) setQuality((prev) => (prev === "auto" ? "auto" : `${l.height}p`));
          });
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (!data.fatal || disposed) return;
            if (data.type === "networkError" && !retriedRef.current) {
              retriedRef.current = true;
              setTimeout(() => hls.startLoad(), 1200);
              return;
            }
            setError("Stream network error — please retry.");
            setBuffering(false);
          });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = stream.url;
          setReady(true);
          tryAutoplay(video);
        } else {
          setError("HLS playback is not supported in this browser.");
        }
        return;
      }

      if (engine === "dash") {
        const dashjs = await import("dashjs");
        if (disposed) return;
        const player = dashjs.MediaPlayer().create();
        dashRef.current = player as unknown as { destroy: () => void; reset: () => void };
        if (stream.clearKey && stream.clearKid) {
          player.setProtectionData({
            "org.w3.clearkey": {
              clearkeys: {
                [uuidToB64url(stream.clearKid)]: hexToB64url(stream.clearKey),
              },
            },
          });
        }
        player.updateSettings({
          streaming: { buffer: { bufferTimeAtTopQuality: 24 } },
        });
        player.initialize(video, stream.url, true);
        player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
          if (disposed) return;
          setReady(true);
          setBuffering(false);
          tryAutoplay(video);
          try {
            const list = ((player as unknown as { getBitrateInfoListFor?: (type: string) => unknown }).getBitrateInfoListFor?.("video") ?? []) as Array<{ qualityIndex: number; height?: number; bitrate?: number }>;
            setLevels(
              list
                .map((b: { qualityIndex: number; height?: number; bitrate?: number }) => ({
                  idx: b.qualityIndex,
                  label: b.height ? `${b.height}p` : `${Math.round((b.bitrate ?? 0) / 1000)}k`,
                }))
                .sort((a: QualityLevel, b: QualityLevel) => b.idx - a.idx)
            );
          } catch {
            /* quality list optional */
          }
        });
        player.on(dashjs.MediaPlayer.events.ERROR, () => {
          if (disposed) return;
          setError("DASH playback failed — the Delta Gate stream could not be decoded.");
          setBuffering(false);
        });
        return;
      }

      // native (mp4 / plain hls on safari)
      video.src = stream.url;
      setReady(true);
      tryAutoplay(video);
    };

    setup().catch(() => {
      if (!disposed) {
        setError("Could not start the stream engine.");
        setBuffering(false);
      }
    });

    return () => {
      disposed = true;
      try {
        hlsRef.current?.destroy();
      } catch {}
      hlsRef.current = null;
      try {
        dashRef.current?.reset();
        dashRef.current?.destroy?.();
      } catch {}
      dashRef.current = null;
      try {
        video.removeAttribute("src");
        video.load();
      } catch {}
    };
  }, [stream.url, stream.engine, stream.clearKey, stream.clearKid, tryAutoplay]);

  /* video element events */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setCurrent(video.currentTime);
    const onMeta = () => {
      setDuration(video.duration || 0);
      setReady(true);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrent(video.duration || 0);
    };
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onError = () => {
      if (video.src && !hlsRef.current && !dashRef.current) {
        setError("This stream could not be loaded.");
        setBuffering(false);
      }
    };
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("durationchange", onMeta);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onError);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("durationchange", onMeta);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
    };
  }, []);

  /* progress ticker — mirrors the YouTube player cadence */
  useEffect(() => {
    const id = window.setInterval(() => {
      const video = videoRef.current;
      if (video && playingRef.current && !video.paused) {
        const t = video.currentTime;
        setCurrent(t);
        if (Math.floor(t) % 10 === 0) onProgress?.(t);
      }
    }, 500);
    return () => clearInterval(id);
  }, [onProgress]);

  /* fullscreen sync */
  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else shellRef.current?.requestFullscreen?.();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video || !ready) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          video.currentTime = Math.min(video.currentTime + 5, video.duration || 0);
          break;
        case "ArrowLeft":
          video.currentTime = Math.max(video.currentTime - 5, 0);
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          toggleFullscreen();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready]);

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value);
    setCurrent(t);
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  const onVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setVolume(v);
    const video = videoRef.current;
    if (!video) return;
    video.volume = v / 100;
    video.muted = v === 0;
    setMuted(v === 0);
  };

  const changeSpeed = (s: number) => {
    setSpeed(s);
    if (videoRef.current) videoRef.current.playbackRate = s;
    setMenu("none");
  };

  const changeQuality = (q: string) => {
    setQuality(q);
    if (q === "auto") {
      if (hlsRef.current) hlsRef.current.currentLevel = -1;
      if (dashRef.current) {
        // dash: re-enable ABR
        (dashRef.current as unknown as { updateSettings?: (s: unknown) => void }).updateSettings?.({
          streaming: { abr: { autoSwitchBitrate: { video: true } } },
        });
      }
    } else {
      const lv = levels.find((l) => l.label === q);
      if (lv) {
        if (hlsRef.current) hlsRef.current.currentLevel = lv.idx;
        if (dashRef.current) {
          (dashRef.current as unknown as { setQualityFor?: (t: string, i: number) => void }).setQualityFor?.("video", lv.idx);
        }
      }
    }
    setMenu("none");
  };

  const showControls = () => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (playingRef.current) setControlsVisible(false);
    }, 2600);
  };

  const pct = duration > 0 ? (current / duration) * 100 : 0;
  const seekTo = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
    setCurrent(t);
  };

  return (
    <div
      ref={shellRef}
      className="relative glass rounded-3xl overflow-hidden group select-none"
      onMouseMove={showControls}
      onMouseLeave={() => playingRef.current && setControlsVisible(false)}
      onTouchStart={showControls}
    >
      <div className="relative w-full aspect-video bg-black">
        <video
          ref={videoRef}
          playsInline
          autoPlay
          preload="metadata"
          className="absolute inset-0 w-full h-full"
        />

        <button
          className="absolute inset-0 cursor-pointer"
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
          aria-label={playing ? "Pause" : "Play"}
        />

        {buffering && !error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Loader2 size={42} className="text-[#f5b52e] animate-spin" />
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center pointer-events-none bg-black/55">
            <ShieldCheck size={30} className="text-[#f5b52e]" />
            <p className="mt-3 text-sm font-bold text-white max-w-md">{error}</p>
          </div>
        )}

        {!playing && !error && current < 0.5 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/35 transition-opacity">
            <span className="w-20 h-20 rounded-full btn-gold flex items-center justify-center">
              <Play size={30} className="ml-1" />
            </span>
          </div>
        )}

        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-10 transition-all duration-300",
            controlsVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"
          )}
        >
          <div className="bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 sm:px-6 pt-14 pb-4">
            <div className="relative">
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.5}
                value={current}
                onChange={onSeek}
                className="sb-range w-full"
                style={{
                  background: `linear-gradient(to right, #f5b52e ${pct}%, rgba(255,255,255,0.25) ${pct}%)`,
                }}
                aria-label="Seek"
              />
            </div>

            <div className="mt-3 flex items-center gap-2 sm:gap-3 text-white">
              <CtrlBtn onClick={togglePlay} label={playing ? "Pause" : "Play"}>
                {playing ? <Pause size={19} /> : <Play size={19} className="ml-0.5" />}
              </CtrlBtn>
              <CtrlBtn onClick={() => seekTo(Math.max(current - 10, 0))} label="Back 10s">
                <SkipBack size={16} />
              </CtrlBtn>
              <CtrlBtn onClick={() => seekTo(Math.min(current + 10, duration))} label="Forward 10s">
                <SkipForward size={16} />
              </CtrlBtn>

              <div className="flex items-center gap-2 group/vol">
                <CtrlBtn onClick={toggleMute} label={muted ? "Unmute" : "Mute"}>
                  {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </CtrlBtn>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={muted ? 0 : volume}
                  onChange={onVolume}
                  className="sb-range w-0 group-hover/vol:w-20 transition-all duration-300 hidden sm:block"
                  style={{
                    background: `linear-gradient(to right, #f5b52e ${muted ? 0 : volume}%, rgba(255,255,255,0.25) ${muted ? 0 : volume}%)`,
                  }}
                  aria-label="Volume"
                />
              </div>

              <span className="text-[11px] sm:text-xs font-semibold tabular-nums text-white/85 ml-1">
                {fmt(current)} / {fmt(duration)}
              </span>

              <div className="flex-1" />

              <div className="relative">
                <CtrlBtn onClick={() => setMenu(menu === "speed" ? "none" : "speed")} label="Playback speed">
                  <span className="flex items-center gap-1 text-xs font-bold">
                    <Gauge size={16} /> {speed}×
                  </span>
                </CtrlBtn>
                {menu === "speed" && (
                  <PlayerMenu>
                    {SPEEDS.map((s) => (
                      <MenuRow key={s} active={s === speed} onClick={() => changeSpeed(s)}>
                        {s === 1 ? "Normal" : `${s}×`}
                      </MenuRow>
                    ))}
                  </PlayerMenu>
                )}
              </div>

              {levels.length > 0 && (
                <div className="relative">
                  <CtrlBtn onClick={() => setMenu(menu === "quality" ? "none" : "quality")} label="Quality">
                    <span className="flex items-center gap-1 text-xs font-bold">
                      <Settings2 size={16} /> {quality === "auto" ? "Auto" : quality}
                    </span>
                  </CtrlBtn>
                  {menu === "quality" && (
                    <PlayerMenu>
                      <MenuRow active={quality === "auto"} onClick={() => changeQuality("auto")}>
                        Auto
                      </MenuRow>
                      {levels
                        .slice()
                        .sort((a, b) => parseInt(b.label) - parseInt(a.label))
                        .map((l) => (
                          <MenuRow key={l.idx} active={quality === l.label} onClick={() => changeQuality(l.label)}>
                            {l.label}
                          </MenuRow>
                        ))}
                    </PlayerMenu>
                  )}
                </div>
              )}

              <CtrlBtn onClick={toggleFullscreen} label="Fullscreen">
                {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </CtrlBtn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PremiumPlayer({
  videoId,
  onProgress,
}: {
  videoId: string;
  onProgress?: (pos: number) => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const playerHostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const rafRef = useRef<number>(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [quality, setQuality] = useState("auto");
  const [levels, setLevels] = useState<string[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [menu, setMenu] = useState<"none" | "speed" | "quality">("none");

  /* create player */
  useEffect(() => {
    let destroyed = false;
    loadYouTubeApi().then((YT) => {
      if (destroyed || !playerHostRef.current) return;
      playerRef.current = new YT.Player(playerHostRef.current, {
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          iv_load_policy: 3,
          fs: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => {
            if (destroyed) return;
            setReady(true);
            setBuffering(false);
            setDuration(e.target.getDuration());
            e.target.setVolume(80);
            setLevels(e.target.getAvailableQualityLevels?.() ?? []);
            e.target.playVideo();
            // Fallback: if sound-autoplay is blocked by the browser, retry muted
            let attempts = 0;
            const kick = () => {
              if (destroyed || attempts >= 4) return;
              attempts++;
              const p = playerRef.current;
              const S = window.YT!.PlayerState;
              const st = p?.getPlayerState();
              if (p && st !== S.PLAYING && st !== S.BUFFERING && st !== S.ENDED) {
                if (attempts >= 2) {
                  p.mute();
                  setMuted(true);
                }
                p.playVideo();
                window.setTimeout(kick, 1800);
              }
            };
            window.setTimeout(kick, 1500);
          },
          onStateChange: (e) => {
            const S = window.YT!.PlayerState;
            if (e.data === S.PLAYING) {
              setPlaying(true);
              setBuffering(false);
              setDuration(e.target.getDuration());
            } else if (e.data === S.PAUSED) {
              setPlaying(false);
            } else if (e.data === S.ENDED) {
              setPlaying(false);
              setCurrent(e.target.getDuration());
            } else if (e.data === S.BUFFERING) {
              setBuffering(true);
            }
          },
          onError: () => setBuffering(false),
        },
      });
    });
    return () => {
      destroyed = true;
      try {
        playerRef.current?.destroy();
      } catch {}
      playerRef.current = null;
    };
  }, [videoId]);

  /* progress ticker */
  useEffect(() => {
    const tick = () => {
      const p = playerRef.current;
      if (p && ready) {
        const t = p.getCurrentTime();
        setCurrent(t);
        if (Math.floor(t) % 10 === 0) onProgress?.(t);
      }
      rafRef.current = window.setTimeout(tick, 500) as unknown as number;
    };
    rafRef.current = window.setTimeout(tick, 800) as unknown as number;
    return () => clearTimeout(rafRef.current);
  }, [ready, onProgress]);

  /* fullscreen sync */
  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.getPlayerState() === window.YT!.PlayerState.PLAYING) p.pauseVideo();
    else p.playVideo();
  };

  const toggleMute = () => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isMuted()) {
      p.unMute();
      setMuted(false);
    } else {
      p.mute();
      setMuted(true);
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else shellRef.current?.requestFullscreen?.();
  };

  /* keyboard shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = playerRef.current;
      if (!p || !ready) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          p.seekTo(Math.min(p.getCurrentTime() + 5, p.getDuration()), true);
          break;
        case "ArrowLeft":
          p.seekTo(Math.max(p.getCurrentTime() - 5, 0), true);
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          toggleFullscreen();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready]);

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value);
    setCurrent(t);
    playerRef.current?.seekTo(t, true);
  };

  const onVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setVolume(v);
    playerRef.current?.setVolume(v);
    if (v === 0) {
      playerRef.current?.mute();
      setMuted(true);
    } else {
      playerRef.current?.unMute();
      setMuted(false);
    }
  };

  const changeSpeed = (s: number) => {
    setSpeed(s);
    playerRef.current?.setPlaybackRate(s);
    setMenu("none");
  };

  const changeQuality = (q: string) => {
    setQuality(q);
    playerRef.current?.setPlaybackQuality(q);
    setMenu("none");
  };

  const showControls = () => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (playingRef.current) setControlsVisible(false);
    }, 2600);
  };

  // keep a ref of playing state for hide timer
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const pct = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div
      ref={shellRef}
      className="relative glass rounded-3xl overflow-hidden group select-none"
      onMouseMove={showControls}
      onMouseLeave={() => playingRef.current && setControlsVisible(false)}
      onTouchStart={showControls}
    >
      {/* video 16:9 */}
      <div className="relative w-full aspect-video bg-black">
        <div ref={playerHostRef} className="absolute inset-0 w-full h-full [&>iframe]:w-full [&>iframe]:h-full" />

        {/* click layer for play/pause (only over the video, not controls) */}
        <button
          className="absolute inset-0 cursor-pointer"
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
          aria-label={playing ? "Pause" : "Play"}
        />

        {/* buffering spinner */}
        {buffering && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Loader2 size={42} className="text-[#f5b52e] animate-spin" />
          </div>
        )}

        {/* big play overlay when paused at start */}
        {!playing && current < 0.5 && ready && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/35 transition-opacity">
            <span className="w-20 h-20 rounded-full btn-gold flex items-center justify-center">
              <Play size={30} className="ml-1" />
            </span>
          </div>
        )}

        {/* controls */}
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-10 transition-all duration-300",
            controlsVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"
          )}
        >
          <div className="bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 sm:px-6 pt-14 pb-4">
            {/* seek bar */}
            <div className="relative">
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.5}
                value={current}
                onChange={onSeek}
                className="sb-range w-full"
                style={{
                  background: `linear-gradient(to right, #f5b52e ${pct}%, rgba(255,255,255,0.25) ${pct}%)`,
                }}
                aria-label="Seek"
              />
            </div>

            <div className="mt-3 flex items-center gap-2 sm:gap-3 text-white">
              <CtrlBtn onClick={togglePlay} label={playing ? "Pause" : "Play"}>
                {playing ? <Pause size={19} /> : <Play size={19} className="ml-0.5" />}
              </CtrlBtn>
              <CtrlBtn
                onClick={() => playerRef.current?.seekTo(Math.max(current - 10, 0), true)}
                label="Back 10s"
              >
                <SkipBack size={16} />
              </CtrlBtn>
              <CtrlBtn
                onClick={() => playerRef.current?.seekTo(Math.min(current + 10, duration), true)}
                label="Forward 10s"
              >
                <SkipForward size={16} />
              </CtrlBtn>

              {/* volume */}
              <div className="flex items-center gap-2 group/vol">
                <CtrlBtn onClick={toggleMute} label={muted ? "Unmute" : "Mute"}>
                  {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </CtrlBtn>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={muted ? 0 : volume}
                  onChange={onVolume}
                  className="sb-range w-0 group-hover/vol:w-20 transition-all duration-300 hidden sm:block"
                  style={{
                    background: `linear-gradient(to right, #f5b52e ${muted ? 0 : volume}%, rgba(255,255,255,0.25) ${muted ? 0 : volume}%)`,
                  }}
                  aria-label="Volume"
                />
              </div>

              <span className="text-[11px] sm:text-xs font-semibold tabular-nums text-white/85 ml-1">
                {fmt(current)} / {fmt(duration)}
              </span>

              <div className="flex-1" />

              {/* speed menu */}
              <div className="relative">
                <CtrlBtn onClick={() => setMenu(menu === "speed" ? "none" : "speed")} label="Playback speed">
                  <span className="flex items-center gap-1 text-xs font-bold">
                    <Gauge size={16} /> {speed}×
                  </span>
                </CtrlBtn>
                {menu === "speed" && (
                  <PlayerMenu>
                    {SPEEDS.map((s) => (
                      <MenuRow key={s} active={s === speed} onClick={() => changeSpeed(s)}>
                        {s === 1 ? "Normal" : `${s}×`}
                      </MenuRow>
                    ))}
                  </PlayerMenu>
                )}
              </div>

              {/* quality menu */}
              <div className="relative">
                <CtrlBtn onClick={() => setMenu(menu === "quality" ? "none" : "quality")} label="Quality">
                  <span className="flex items-center gap-1 text-xs font-bold">
                    <Settings2 size={16} /> {qualityLabel(quality)}
                  </span>
                </CtrlBtn>
                {menu === "quality" && (
                  <PlayerMenu>
                    <MenuRow active={quality === "auto"} onClick={() => changeQuality("auto")}>
                      Auto
                    </MenuRow>
                    {levels
                      .filter((l) => l !== "auto")
                      .sort((a, b) => parseInt(b) - parseInt(a))
                      .map((l) => (
                        <MenuRow key={l} active={quality === l} onClick={() => changeQuality(l)}>
                          {qualityLabel(l)}
                        </MenuRow>
                      ))}
                  </PlayerMenu>
                )}
              </div>

              <CtrlBtn onClick={toggleFullscreen} label="Fullscreen">
                {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </CtrlBtn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CtrlBtn({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 hover:text-[#f8d477] hover:bg-white/10 transition-colors cursor-pointer"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function PlayerMenu({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute bottom-12 right-0 z-20 glass rounded-2xl py-2 min-w-[140px] sb-fade-up">
      <p className="px-4 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Settings</p>
      {children}
    </div>
  );
}

function MenuRow({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-2 text-[13px] font-semibold cursor-pointer transition-colors",
        active ? "text-[#f8d477] bg-[#f5b52e]/10" : "text-foreground/85 hover:bg-white/6"
      )}
    >
      {children}
    </button>
  );
}

function qualityLabel(q: string): string {
  if (!q || q === "auto" || q === "default") return "Auto";
  if (q === "highres") return "4K";
  if (q === "hd2160") return "4K";
  if (q === "hd1440") return "1440p";
  if (q === "hd1080") return "1080p";
  if (q === "hd720") return "720p";
  if (q === "large") return "480p";
  if (q === "medium") return "360p";
  if (q === "small") return "240p";
  if (q === "tiny") return "144p";
  return q.toUpperCase();
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function prettify(slug: string): string {
  return slug
    .split("-")
    .slice(0, -1)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
