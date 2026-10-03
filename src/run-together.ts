/**
 * Pages whose words come back stuck together, and how we notice.
 *
 * Some sites wrap **every character in its own element** — `<span>T</span><span>h</span>…`
 * — for a letter-by-letter animation. The spaces are there too, as `<span> </span>`, but
 * the markdown conversion drops inline elements that contain only whitespace, so the text
 * arrives as `Thisdomainisforuseindocumentation`. It is common enough on marketing front
 * pages to matter, and `example.com` does it, which is how we found it: our own
 * documentation told everyone to scrape the one page that came back as mush.
 *
 * Returning that to somebody who paid is the worst kind of failure — it looks like a
 * success. So we notice, and re-convert from the html, where the spaces survive.
 */

/** A word this long is not a word. The longest in English is 45 letters. */
const ABSURD = 30;

/** Below this share of the prose we leave it alone: one odd token is not a broken page. */
const SHARE = 0.25;

/**
 * A single run can be conclusive, but only when it is most of the page.
 *
 * The first version of this demanded two, because the page that started it had five
 * languages and so produced five. A page with one paragraph produces exactly one, and the
 * detector sat there watching `Thisdomainisforuse…` go out of the door.
 */
const SHARE_ALONE = 0.5;

/** Markdown that is not prose: code, urls, images, tables of hashes. */
function prose(markdown: string): string {
  return markdown
    .replace(/^---\n[\s\S]*?\n---\n/, "") // our own frontmatter
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, " ") // links and images, target and all
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\w.+-]+@[\w.-]+/g, " ");
}

/**
 * Only scripts that separate words with spaces can be judged this way: Chinese, Japanese
 * and Thai run together by design, and calling that broken would be a bug of our own.
 */
const LATIN_ISH = /[A-Za-zÀ-ÿĀ-ſА-яΑ-ωА-я]/;

export function wordsRunTogether(markdown: string | undefined): boolean {
  if (typeof markdown !== "string" || markdown.length < 80) return false;

  let absurd = 0;
  let absurdChars = 0;
  let letters = 0;

  for (const token of prose(markdown).split(/\s+/)) {
    if (!token) continue;
    const alpha = [...token].filter((ch) => LATIN_ISH.test(ch)).length;
    if (!alpha) continue;
    letters += alpha;
    // A long token that is overwhelmingly letters, rather than an id, a hash or a path.
    if (alpha >= ABSURD && alpha / token.length > 0.8) {
      absurd += 1;
      absurdChars += alpha;
    }
  }

  if (absurd === 0 || letters === 0) return false;
  const share = absurdChars / letters;
  return absurd >= 2 ? share >= SHARE : share >= SHARE_ALONE;
}
