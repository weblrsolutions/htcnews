import "./styles.css";
import type { Article, ArticlesFile } from "./types";
import { CATEGORY_LABELS, COUNTRY_LABELS, FEATURED_REGIONS } from "./types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "for",
  "on",
  "at",
  "by",
  "with",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "its",
  "it",
  "this",
  "that",
  "these",
  "those",
  "into",
  "over",
  "after",
  "before",
  "about",
  "new",
  "how",
  "why",
  "what",
  "when",
  "who",
  "will",
  "can",
  "may",
  "not",
  "has",
  "have",
  "had",
  "their",
  "our",
  "your",
  "his",
  "her",
  "than",
  "via",
  "amid",
  "says",
  "said",
  "report",
  "reports",
  "news",
]);

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("#app missing");
}

type TimeWindow = "24h" | "7d" | "30d" | "all";

const TIME_WINDOWS: { id: TimeWindow; label: string; hours: number | null }[] = [
  { id: "24h", label: "24 hours", hours: 24 },
  { id: "7d", label: "This week", hours: 24 * 7 },
  { id: "30d", label: "This month", hours: 24 * 30 },
  { id: "all", label: "All time", hours: null },
];

const PAGE_SIZE = 12;

let activeRegion = "all";
let activeCategory = "all";
let activeTime: TimeWindow = "7d";
let searchQuery = "";
let activeTrend = "";
let currentPage = 1;

/** Compact page list with ellipses, e.g. 1 … 4 5 6 … 20 */
function pageWindow(current: number, total: number): (number | "…")[] {
  const delta = 1;
  const range: number[] = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) {
      range.push(i);
    }
  }
  const out: (number | "…")[] = [];
  let prev: number | undefined;
  for (const i of range) {
    if (prev !== undefined) {
      if (i - prev === 2) out.push(prev + 1);
      else if (i - prev > 2) out.push("…");
    }
    out.push(i);
    prev = i;
  }
  return out;
}

function withinTimeWindow(iso: string, window: TimeWindow): boolean {
  const hours = TIME_WINDOWS.find((t) => t.id === window)?.hours ?? null;
  if (hours === null) return true;
  const published = new Date(iso).getTime();
  if (Number.isNaN(published)) return false;
  return Date.now() - published <= hours * 3600_000;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZoneName: "short",
  });
}

function formatUpdated(iso: string): string {
  const absolute = formatAbsolute(iso);
  if (!absolute) return "";
  const relative = formatRelative(iso);
  return relative ? `Updated ${absolute} (${relative})` : `Updated ${absolute}`;
}

function uniqueSorted(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function countryLabel(code: string | null | undefined): string {
  if (!code) return "";
  return COUNTRY_LABELS[code] ?? code;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

/** Top keywords — size scales with how often they appear. */
function buildTrending(
  articles: Article[],
  limit = 6,
): { word: string; size: number }[] {
  const counts = new Map<string, number>();
  for (const a of articles.slice(0, 80)) {
    for (const w of tokenize(a.title)) {
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  const sorted = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);

  if (sorted.length === 0) return [];

  const max = sorted[0][1];
  const min = sorted[sorted.length - 1][1];
  return sorted.map(([word, n]) => {
    const t = max === min ? 1 : (n - min) / (max - min);
    // ~13px quiet → ~26px loud (Pulse-style cloud)
    const size = Math.round(13 + t * 13);
    return { word, size };
  });
}

function renderShell(): void {
  const timeOptions = TIME_WINDOWS.map(
    (t) =>
      `<option value="${t.id}"${t.id === activeTime ? " selected" : ""}>${t.label}</option>`,
  ).join("");

  const regionOptions = [
    `<option value="all" selected>All regions</option>`,
    ...FEATURED_REGIONS.map((r) => `<option value="${r.code}">${r.label}</option>`),
  ].join("");

  app!.innerHTML = `
    <div class="wrap">
      <header class="site-header">
        <div class="brand-row">
          <h1 class="logo">
            <a href="./" aria-label="HTC News — Health Tech Circle's News">
              <span class="logo-mark">Health Tech Circle's <span>News</span></span>
            </a>
          </h1>
          <div class="search">
            <input type="search" id="q" placeholder="Search stories…" autocomplete="off" aria-label="Search stories" />
          </div>
        </div>
        <p class="intro">
          HTC News — digital health, medtech, AI-in-healthcare &amp; wellness-tech headlines from trusted sources, aggregated in one place.
        </p>
      </header>

      <div class="toolbar" role="search" aria-label="Filter stories">
        <label class="toolbar-field">
          <span class="toolbar-label">Time</span>
          <select id="time" aria-label="Time range">${timeOptions}</select>
        </label>
        <label class="toolbar-field">
          <span class="toolbar-label">Region</span>
          <select id="region" aria-label="Region">${regionOptions}</select>
        </label>
        <label class="toolbar-field">
          <span class="toolbar-label">Category</span>
          <select id="category" aria-label="Category">
            <option value="all">All categories</option>
          </select>
        </label>
      </div>

      <div class="trending" id="trending" hidden></div>

      <div class="feed-head">
        <h2 class="feed-label">Health tech news</h2>
        <p class="meta-bar" id="meta" hidden></p>
      </div>
      <ul class="feed" id="feed" aria-live="polite"></ul>
      <nav class="pager" id="pager" aria-label="Pagination" hidden></nav>
    </div>
    <footer class="site-footer">
      <nav class="footer-links" aria-label="Follow and contact">
        <a href="https://whatsapp.com/channel/0029VbDBdm75kg6ylzr4rr1U" rel="noopener noreferrer" target="_blank">
          <svg class="footer-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm0 18.02h-.01c-1.52 0-3.01-.41-4.3-1.18l-.31-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.39c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.25 8.24Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29Z"/></svg>
          <span>WhatsApp</span>
        </a>
        <a href="https://t.me/healthtechcircle" rel="noopener noreferrer" target="_blank">
          <svg class="footer-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M21.94 4.6 18.6 20.36c-.25 1.11-.91 1.38-1.85.86l-5.1-3.76-2.46 2.37c-.27.27-.5.5-1.02.5l.36-5.19 9.45-8.54c.41-.36-.09-.57-.64-.2L5.62 13.06.6 11.49c-1.09-.34-1.11-1.09.23-1.62L20.53 3.03c.91-.34 1.7.2 1.41 1.57Z"/></svg>
          <span>Telegram</span>
        </a>
        <a href="mailto:drpatelakshat@gmail.com?subject=HTC%20News%20%E2%80%94%20Suggestion%20/%20Sponsorship">
          <svg class="footer-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2Zm0 2v.4l8 5 8-5V6H4Zm16 2.75-7.47 4.67c-.33.2-.73.2-1.06 0L4 8.75V18h16V8.75Z"/></svg>
          <span>Suggestions &amp; Sponsorship</span>
        </a>
      </nav>
      <p>Summaries are original. Every headline links to the publisher.</p>
      <p class="disclaimer">
        Stories are aggregated from public RSS sources. We do not own, edit, or independently verify
        the underlying reporting — always confirm details on the publisher’s site.
      </p>
    </footer>
  `;
}

function populateCategoryFilter(articles: Article[]): void {
  const catSelect = document.querySelector<HTMLSelectElement>("#category");
  if (!catSelect) return;

  const categories = uniqueSorted(articles.map((a) => a.category));
  for (const c of categories) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = CATEGORY_LABELS[c] ?? c;
    catSelect.append(opt);
  }
}

function syncTrendUi(): void {
  const strip = document.querySelector<HTMLElement>("#trending");
  if (!strip) return;
  strip.querySelectorAll<HTMLAnchorElement>(".trend-word").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.word === activeTrend);
  });
  const clearBtn = strip.querySelector<HTMLButtonElement>(".trend-clear");
  if (clearBtn) clearBtn.hidden = !activeTrend;
}

function renderTrending(articles: Article[]): void {
  const strip = document.querySelector<HTMLElement>("#trending");
  if (!strip) return;

  const words = buildTrending(articles, 6);
  if (words.length === 0) {
    strip.hidden = true;
    strip.innerHTML = "";
    return;
  }

  strip.hidden = false;
  strip.innerHTML = `
    <span class="trending-label">Trending</span>
    <div class="trending-words">
      ${words
        .map(
          (w) =>
            `<a href="#${escapeHtml(w.word)}" data-word="${escapeHtml(w.word)}" class="trend-word${
              activeTrend === w.word ? " is-active" : ""
            }" style="font-size: ${w.size}px">${escapeHtml(w.word)}</a>`,
        )
        .join("")}
    </div>
    <button type="button" class="trend-clear" hidden>Clear</button>
  `;
  syncTrendUi();
}

function filterArticles(articles: Article[]): Article[] {
  const q = searchQuery.trim().toLowerCase();
  return articles.filter((a) => {
    if (!withinTimeWindow(a.published_at, activeTime)) return false;
    if (activeCategory !== "all" && a.category !== activeCategory) return false;
    if (activeRegion !== "all" && a.country !== activeRegion) return false;
    if (activeTrend) {
      const hay = `${a.title} ${a.summary}`.toLowerCase();
      if (!hay.includes(activeTrend)) return false;
    }
    if (q) {
      const hay = `${a.title} ${a.summary} ${a.source}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderFeed(articles: Article[], updatedAt: string | null): void {
  const feed = document.querySelector<HTMLUListElement>("#feed");
  const meta = document.querySelector<HTMLElement>("#meta");
  if (!feed || !meta) return;

  const regionName =
    activeRegion === "all" ? "All regions" : countryLabel(activeRegion) || activeRegion;
  const timeLabel = TIME_WINDOWS.find((t) => t.id === activeTime)?.label ?? activeTime;

  if (articles.length === 0) {
    meta.hidden = false;
    meta.textContent = `0 stories · ${timeLabel} · ${regionName}${
      updatedAt ? ` · ${formatUpdated(updatedAt)}` : ""
    }`;
    feed.innerHTML = `<li class="empty">No stories match. Try another time range, region, or clear trending / search.</li>`;
    renderPager(1);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(articles.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = articles.slice(start, start + PAGE_SIZE);

  meta.hidden = false;
  meta.textContent = `Showing ${start + 1}–${start + pageItems.length} of ${articles.length} · ${timeLabel} · ${regionName}${
    updatedAt ? ` · ${formatUpdated(updatedAt)}` : ""
  }`;

  feed.innerHTML = pageItems
    .map((a) => {
      const cat = CATEGORY_LABELS[a.category] ?? a.category;
      const country = a.country ? countryLabel(a.country) : "";
      const desc = a.summary?.trim()
        ? `<div class="item-desc">${escapeHtml(a.summary)}</div>`
        : "";
      return `
        <li class="item">
          <h2 class="item-title">
            <a href="${escapeHtml(a.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(a.title)}</a>
          </h2>
          ${desc}
          <div class="item-foot">
            <span class="date" title="${escapeHtml(formatAbsolute(a.published_at))}">${escapeHtml(
              formatRelative(a.published_at),
            )}</span>
            <span class="feed-src">${escapeHtml(a.source)}</span>
          </div>
          <div class="item-tags">
            <span class="tag">${escapeHtml(cat)}</span>
            ${country ? `<span class="tag">${escapeHtml(country)}</span>` : ""}
          </div>
        </li>
      `;
    })
    .join("");

  renderPager(totalPages);
}

function renderPager(totalPages: number): void {
  const pager = document.querySelector<HTMLElement>("#pager");
  if (!pager) return;

  if (totalPages <= 1) {
    pager.hidden = true;
    pager.innerHTML = "";
    return;
  }

  pager.hidden = false;
  const numbers = pageWindow(currentPage, totalPages)
    .map((p) =>
      p === "…"
        ? `<span class="pager-gap" aria-hidden="true">…</span>`
        : `<button type="button" class="pager-num${
            p === currentPage ? " is-active" : ""
          }" data-page="${p}"${
            p === currentPage ? ' aria-current="page"' : ""
          } aria-label="Page ${p}">${p}</button>`,
    )
    .join("");

  pager.innerHTML = `
    <button type="button" class="pager-btn" data-page="prev"${
      currentPage === 1 ? " disabled" : ""
    } aria-label="Previous page">‹ Prev</button>
    <div class="pager-pages">${numbers}</div>
    <button type="button" class="pager-btn" data-page="next"${
      currentPage === totalPages ? " disabled" : ""
    } aria-label="Next page">Next ›</button>
  `;
}

async function loadArticles(): Promise<ArticlesFile> {
  const res = await fetch("./articles.json", { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`Could not load articles (${res.status})`);
  }
  return (await res.json()) as ArticlesFile;
}

async function boot(): Promise<void> {
  renderShell();
  const feed = document.querySelector<HTMLUListElement>("#feed");
  try {
    const data = await loadArticles();
    const articles = [...(data.articles ?? [])].sort((a, b) =>
      (b.published_at || "").localeCompare(a.published_at || ""),
    );

    populateCategoryFilter(articles);
    renderTrending(articles);

    const timeSelect = document.querySelector<HTMLSelectElement>("#time");
    const regionSelect = document.querySelector<HTMLSelectElement>("#region");
    const catSelect = document.querySelector<HTMLSelectElement>("#category");
    const search = document.querySelector<HTMLInputElement>("#q");
    const trending = document.querySelector<HTMLElement>("#trending");
    const pager = document.querySelector<HTMLElement>("#pager");

    const refresh = (resetPage = true) => {
      if (resetPage) currentPage = 1;
      renderFeed(filterArticles(articles), data.updated_at);
      syncTrendUi();
    };

    timeSelect?.addEventListener("change", () => {
      const id = timeSelect.value as TimeWindow;
      if (!TIME_WINDOWS.some((t) => t.id === id)) return;
      activeTime = id;
      refresh();
    });

    regionSelect?.addEventListener("change", () => {
      activeRegion = regionSelect.value;
      refresh();
    });

    catSelect?.addEventListener("change", () => {
      activeCategory = catSelect.value;
      refresh();
    });

    search?.addEventListener("input", () => {
      searchQuery = search.value;
      refresh();
    });

    trending?.addEventListener("click", (ev) => {
      const clear = (ev.target as HTMLElement).closest<HTMLButtonElement>(".trend-clear");
      if (clear) {
        activeTrend = "";
        refresh();
        return;
      }
      const word = (ev.target as HTMLElement).closest<HTMLAnchorElement>(".trend-word");
      if (!word?.dataset.word) return;
      ev.preventDefault();
      activeTrend = activeTrend === word.dataset.word ? "" : word.dataset.word;
      refresh();
    });

    pager?.addEventListener("click", (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("button[data-page]");
      if (!btn || btn.disabled) return;
      const val = btn.dataset.page;
      if (val === "prev") currentPage -= 1;
      else if (val === "next") currentPage += 1;
      else {
        const n = Number(val);
        if (Number.isNaN(n)) return;
        currentPage = n;
      }
      refresh(false);
      document
        .querySelector(".feed-head")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    refresh();
  } catch (err) {
    if (feed) {
      feed.innerHTML = `<li class="error">Feed unavailable. Run the ingest script and rebuild, or check that articles.json is deployed.</li>`;
    }
    console.error(err);
  }
}

void boot();
