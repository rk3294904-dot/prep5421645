"use client";

import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { useApp } from "@/lib/store";
import { GlassButton } from "./glass";
import { Search, Menu, X, Trophy, LogIn, Medal, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { firebaseAuth, getLeaderboard, signInWithGoogle, signOutUser } from "@/lib/firebase";

interface LeaderboardEntry {
  rank: number;
  id: string;
  displayName?: string;
  photoURL?: string;
  points?: number;
}

export function SiteHeader() {
  const { navigate, searchQuery, setSearchQuery } = useApp();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (showSearch) searchRef.current?.focus();
  }, [showSearch]);

  useEffect(() => onAuthStateChanged(firebaseAuth, setUser), []);

  useEffect(() => {
    if (!showLeaderboard) return;
    let alive = true;
    setLoadingLeaderboard(true);
    getLeaderboard()
      .then((nextEntries) => alive && setEntries(nextEntries))
      .catch(() => alive && setEntries([]))
      .finally(() => alive && setLoadingLeaderboard(false));
    return () => {
      alive = false;
    };
  }, [showLeaderboard]);

  const go = (target: Parameters<typeof navigate>[0]) => {
    setMobileOpen(false);
    navigate(target);
  };

  return (
    <header className="sticky top-0 z-50 px-3 pt-3 sm:px-5">
      <div className={cn("relative mx-auto max-w-7xl rounded-3xl glass transition-all duration-500", scrolled && "shadow-[0_18px_50px_rgba(0,0,0,0.5)]")}>
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
          <button onClick={() => go({ view: "home" })} className="group flex shrink-0 cursor-pointer items-center gap-3" aria-label="Quantica Digital home">
            <span className="relative h-11 w-11 overflow-hidden rounded-2xl border border-white/15 bg-black shadow-[0_0_24px_rgba(245,181,46,0.25)] transition-shadow group-hover:shadow-[0_0_32px_rgba(245,181,46,0.45)]">
              <img src="/logo-256.png" alt="Quantica Digital logo" className="h-full w-full object-cover" />
            </span>
            <span className="hidden flex-col text-left leading-none sm:flex">
              <span className="text-lg font-extrabold tracking-tight text-gold">QUANTICA DIGITAL</span>
              <span className="text-[10px] font-semibold tracking-[0.28em] text-muted-foreground">DIGITAL LEARNING</span>
            </span>
          </button>

          <nav className="ml-6 hidden items-center gap-1 lg:flex" aria-label="Primary">
            <button type="button" onClick={() => setShowLeaderboard((open) => !open)} className={cn("flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] font-semibold transition-all", showLeaderboard ? "border-[#f5b52e]/35 bg-[#f5b52e]/15 text-[#f8d477]" : "border-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground")}>
              <Trophy size={15} /> Leaderboard
            </button>
          </nav>

          <div className="flex-1" />
          <div className={cn("hidden items-center rounded-full border border-white/12 bg-white/5 backdrop-blur-md transition-all duration-300 md:flex", showSearch ? "w-72 px-4" : "w-52 px-4")}>
            <Search size={15} className="shrink-0 text-muted-foreground" />
            <input ref={searchRef} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onFocus={() => setShowSearch(true)} placeholder="Search your batch..." className="h-10 w-full bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground/70" aria-label="Search batches" />
          </div>

          {user ? <button type="button" onClick={() => signOutUser()} aria-label="Sign out" title={user.displayName ?? "Sign out"} className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white/10 text-sm font-bold text-foreground ring-1 ring-white/10 transition-colors hover:bg-white/15">
            {user.photoURL ? <img src={user.photoURL} alt="" className="h-full w-full object-cover" /> : (user.displayName?.[0] ?? "U").toUpperCase()}
          </button> : <button type="button" onClick={() => void signInWithGoogle()} aria-label="Sign in with Google" title="Sign in with Google" className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-muted-foreground transition-colors hover:border-white/30 hover:text-foreground"><LogIn size={16} /></button>}

          <button className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full glass lg:hidden" onClick={() => setMobileOpen((value) => !value)} aria-label={mobileOpen ? "Close menu" : "Open menu"}>
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {mobileOpen && (
          <div className="grid grid-cols-1 gap-2 border-t border-white/8 px-4 py-3 sb-fade-up lg:hidden">
            <GlassButton variant={showLeaderboard ? "gold" : "glass"} className="w-full justify-start" onClick={() => setShowLeaderboard((open) => !open)}><Trophy size={16} /> Leaderboard</GlassButton>
            <div className="flex items-center rounded-full border border-white/12 bg-white/5 px-4 md:hidden"><Search size={15} className="text-muted-foreground" /><input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search your batch..." className="h-10 w-full bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground/70" aria-label="Search batches" /></div>
          </div>
        )}

        {showLeaderboard && <LeaderboardPanel entries={entries} loading={loadingLeaderboard} currentUserId={user?.uid} />}
      </div>
    </header>
  );
}

function LeaderboardPanel({ entries, loading, currentUserId }: { entries: LeaderboardEntry[]; loading: boolean; currentUserId?: string }) {
  return (
    <div className="absolute right-3 top-[calc(100%+12px)] z-50 w-[min(360px,calc(100vw-24px))] rounded-3xl glass p-4 shadow-2xl sb-fade-up">
      <div className="flex items-center gap-2 border-b border-white/10 px-2 pb-3"><Medal size={17} className="text-[#f5b52e]" /><div><p className="text-sm font-bold">Learning leaderboard</p><p className="text-[11px] text-muted-foreground">Points earned while watching lectures</p></div></div>
      {loading ? <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-[#f5b52e]" /></div> : entries.length === 0 ? <p className="px-2 py-8 text-center text-sm text-muted-foreground">Start a lecture to claim the first spot.</p> : <div className="mt-2 space-y-1">{entries.map((entry) => <div key={entry.id} className={cn("flex items-center gap-3 rounded-2xl px-2.5 py-2", entry.id === currentUserId && "bg-[#f5b52e]/10")}><span className="w-5 text-center text-xs font-bold text-[#f5b52e]">{entry.rank}</span><span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-white/10 text-xs font-bold">{entry.photoURL ? <img src={entry.photoURL} alt="" className="h-full w-full object-cover" /> : (entry.displayName?.[0] ?? "L").toUpperCase()}</span><span className="min-w-0 flex-1 truncate text-sm font-semibold">{entry.displayName ?? "Learner"}</span><span className="text-xs font-bold text-[#f8d477]">{entry.points ?? 0} pts</span></div>)}</div>}
    </div>
  );
}
