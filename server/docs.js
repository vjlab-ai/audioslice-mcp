// The AudioSlice documentation, vendored from the docs site by sync-docs.mjs.
//
// It is on disk beside the server rather than fetched, because this server makes
// no outbound network calls: it has to work at a venue with no wifi, and it ships
// sealed inside a signed app. The corpus is ~25 KB, so it is read once at startup
// and held in memory.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(HERE, "..", "docs");

// Words that match nearly every page, so matching them says nothing about
// relevance. "audioslice" is in here for that reason, not by oversight.
const STOP = new Set([
  "a", "an", "and", "the", "is", "are", "was", "were", "be", "to", "of", "in", "on", "for",
  "it", "this", "that", "with", "as", "at", "by", "or", "from", "how", "do", "does", "i",
  "my", "me", "can", "what", "when", "which", "you", "your", "audioslice",
]);

function tokenize(s) {
  return (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 1 && !STOP.has(w));
}

// Split a page on its ## headings. A section is the unit worth returning: whole
// pages are too coarse to answer "what does Threshold do" without burying it,
// and paragraphs are too fine to carry the heading that gives them meaning.
function sectionise(slug, title, body) {
  const lines = body.split("\n");
  const sections = [];
  let heading = null;
  let buf = [];

  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) sections.push({ slug, page: title, heading, text });
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      flush();
      heading = m[1].trim();
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

function load() {
  const manifestPath = join(DOCS_DIR, "MANIFEST.json");
  // Missing docs must not take the server down - every other tool still works,
  // and the docs tools report the problem when called.
  if (!existsSync(manifestPath)) {
    return { pages: [], sections: [], bodies: new Map(), ok: false };
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const bodies = new Map();
    const sections = [];
    for (const p of manifest.pages) {
      const body = readFileSync(join(DOCS_DIR, p.file), "utf8");
      bodies.set(p.slug, { title: p.title, body });
      sections.push(...sectionise(p.slug, p.title, body));
    }
    return { pages: manifest.pages, sections, bodies, ok: true };
  } catch {
    return { pages: [], sections: [], bodies: new Map(), ok: false };
  }
}

const DOCS = load();

export const docsAvailable = DOCS.ok;
export const docPages = DOCS.pages;

/** Slugs, for tool descriptions and error messages. */
export function pageList() {
  return DOCS.pages.map((p) => p.slug);
}

/**
 * Rank sections against a query. Scoring is deliberately crude - no index, no
 * stemming - because the corpus is a dozen pages and precision matters less than
 * never missing the one page that answers the question.
 */
export function searchDocs(query, limit = 5) {
  const terms = tokenize(query);
  if (!terms.length) return [];

  const scored = [];
  for (const s of DOCS.sections) {
    const hay = `${s.page} ${s.heading || ""} ${s.text}`.toLowerCase();
    let score = 0;
    let matched = 0;
    for (const t of terms) {
      const inBody = (hay.match(new RegExp(escapeRegex(t), "g")) || []).length;
      if (inBody) matched++;
      score += inBody;
      // A term in the heading is a much stronger signal than the same term
      // buried in prose, which is how "envelope" finds the Envelope Creator page
      // rather than the passing mentions elsewhere.
      if ((s.heading || "").toLowerCase().includes(t)) score += 12;
      if (s.page.toLowerCase().includes(t)) score += 6;
    }
    // Require every term for multi-term queries where that is achievable, so
    // "resolume threshold" does not rank a page that only mentions thresholds.
    if (score > 0) scored.push({ ...s, score, matched });
  }

  const all = terms.length;
  const complete = scored.filter((s) => s.matched === all);
  const pool = complete.length ? complete : scored;

  return pool.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Full text of one page, or null if the slug is unknown. */
export function readDoc(slug) {
  return DOCS.bodies.get(slug) || null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
