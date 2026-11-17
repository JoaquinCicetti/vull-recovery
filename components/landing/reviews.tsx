"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Stars } from "@/components/survey/inputs";
import { UserAvatar } from "@/components/ui/user-avatar";

// Shape of public.public_reviews() (survey_reviews migration).
type Review = {
  id: string;
  first_name: string | null;
  avatar_seed: string;
  rating: number;
  comment: string;
  service: string | null;
  published_at: string;
};

const PAGE = 5;

// Public comments clients left at the end of their survey and an admin approved
// (ADR 0018), newest first. Fetched in the browser so the home page stays
// static: an approval shows up without a deploy. Renders nothing until there is
// at least one. The strip loads the next page (keyset cursor) when its end
// scrolls into view.
export function Reviews() {
  const [items, setItems] = useState<Review[]>([]);
  const [more, setMore] = useState(true);
  const busy = useRef(false);
  const cursor = useRef<Review | null>(null);
  const strip = useRef<HTMLUListElement>(null);
  const sentinel = useRef<HTMLLIElement>(null);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const last = cursor.current;
    const { data, error } = await createClient().rpc("public_reviews", {
      p_limit: PAGE,
      p_before: last?.published_at ?? null,
      p_before_id: last?.id ?? null,
    });
    const page = (data ?? []) as Review[];
    if (error || page.length < PAGE) setMore(false);
    if (page.length) {
      cursor.current = page[page.length - 1];
      setItems((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...page.filter((r) => !seen.has(r.id))];
      });
    }
    busy.current = false;
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Next page when the end of the strip comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more || items.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void load();
      },
      { root: strip.current, rootMargin: "0px 400px 0px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [items.length, more, load]);

  if (items.length === 0) return null;

  const scroll = (dir: 1 | -1) => {
    const el = strip.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" });
  };
  const arrow =
    "hidden size-10 items-center justify-center rounded-md border border-border text-fg-muted transition-colors duration-150 hover:border-border-strong hover:text-fg sm:flex";

  return (
    <section
      id="opiniones"
      aria-labelledby="opiniones-title"
      className="relative scroll-mt-16 border-t border-border px-5 py-24 sm:py-32"
    >
      <div className="mx-auto max-w-6xl">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Opiniones</p>
            <h2 id="opiniones-title" className="mt-5 text-4xl font-extrabold tracking-tight sm:text-6xl">
              Lo que dicen
            </h2>
          </div>
          {items.length > 1 && (
            <div className="flex gap-2">
              <button type="button" className={arrow} onClick={() => scroll(-1)} aria-label="Opiniones anteriores">
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <button type="button" className={arrow} onClick={() => scroll(1)} aria-label="Más opiniones">
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
          )}
        </div>

        {/* Bleeds to the screen edge on a phone so the next card peeks in. */}
        <ul
          ref={strip}
          className="-mx-5 mt-12 flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((r) => (
            <li
              key={r.id}
              className="surface-card surface-lift flex w-[82%] shrink-0 snap-start flex-col rounded-2xl p-6 sm:w-[22rem]"
            >
              <Stars value={r.rating} className="[&_svg]:size-4" />
              <blockquote className="mt-4 flex-1 whitespace-pre-line text-[15px] leading-relaxed text-fg">
                {r.comment}
              </blockquote>
              <div className="mt-6 flex items-center gap-3 border-t border-border pt-4">
                <UserAvatar seed={r.avatar_seed} size={36} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-fg">{r.first_name ?? "Cliente"}</p>
                  {r.service && <p className="truncate text-xs text-fg-faint">{r.service}</p>}
                </div>
              </div>
            </li>
          ))}
          {more && <li ref={sentinel} aria-hidden className="w-px shrink-0" />}
        </ul>
      </div>
    </section>
  );
}
