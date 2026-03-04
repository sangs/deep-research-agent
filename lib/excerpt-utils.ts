/**
 * Strip markdown/HTML noise from raw Exa page text.
 * Used as a fallback when Exa highlights are unavailable, and also
 * applied to highlights themselves to remove any residual formatting.
 */
export function cleanExcerpt(text: string, maxChars = 200): string {
  let t = text;
  // Decode common HTML entities
  t = t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  t = t.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Remove images: ![alt](url)
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // Replace markdown links [text](url) with just the text
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Remove bare brackets up to 200 chars — catches nav/social items of any typical length
  t = t.replace(/\[[^\]]{0,200}\]/g, '');
  // Strip any lone ] left behind after bracket removal
  t = t.replace(/\]/g, '');
  // Remove heading markers at line-start OR after whitespace (catches inline ## in collapsed text)
  t = t.replace(/(^|[\s])#{1,6}\s+/gm, '$1');
  // Remove bold/italic markers (**text**, *text*, __text__, _text_)
  t = t.replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2');
  // Remove trailing colon-asterisk patterns like :**  or :***
  t = t.replace(/:\*+/g, ':');
  // Remove standalone asterisks/underscores used as bullets (* item, - item)
  t = t.replace(/(?<!\w)[*_](?!\w)/g, '');
  // Replace inline code with a space to prevent word fusion (e.g. `LangChain` → ' ')
  t = t.replace(/`[^`]*`/g, ' ');
  // Remove HTML tags
  t = t.replace(/<[^>]+>/g, '');
  // Remove horizontal rules (--- or ***)
  t = t.replace(/^[-*]{3,}\s*$/gm, '');
  // Collapse whitespace
  t = t.replace(/\s+/g, ' ').trim();
  return t.slice(0, maxChars) + (t.length > maxChars ? '…' : '');
}

/**
 * Strip a leading title echo from an excerpt.
 * Exa sometimes starts page text with the article title verbatim — remove it
 * so the excerpt shows body content instead.
 */
export function stripLeadingTitle(excerpt: string, title: string): string {
  if (!title || !excerpt) return excerpt;
  // Normalise both to lowercase for comparison
  const normExcerpt = excerpt.trimStart();
  const normTitle = title.trim();
  if (normExcerpt.toLowerCase().startsWith(normTitle.toLowerCase())) {
    const remainder = normExcerpt.slice(normTitle.length).replace(/^[\s|–—:-]+/, '');
    // Only use the stripped version if there's meaningful content left
    if (remainder.length > 20) return remainder;
  }
  return excerpt;
}
