const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "a",
  "img",
  "span",
  "div",
  "hr",
  "figure",
  "figcaption",
]);

const VOID_TAGS = new Set(["br", "hr", "img"]);

const DROP_CONTAINER_TAGS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "applet",
  "svg",
  "math",
  "form",
  "textarea",
  "template",
  "noscript",
  "head",
  "title",
];

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripControlAndWhitespace(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code > 0x20 && (code < 0x7f || code > 0x9f)) {
      out += raw[i];
    }
  }
  return out;
}

function isSafeUrl(raw: string, allowMailto: boolean): boolean {
  const cleaned = stripControlAndWhitespace(raw);
  if (!cleaned) {
    return false;
  }
  if (cleaned.startsWith("/") && !cleaned.startsWith("//")) {
    return true;
  }
  const lower = cleaned.toLowerCase();
  if (lower.startsWith("https://") || lower.startsWith("http://")) {
    return true;
  }
  if (allowMailto && lower.startsWith("mailto:")) {
    return true;
  }
  return false;
}

function sanitizeAttributes(tag: string, rawAttrs: string): string {
  if (!rawAttrs.trim()) {
    return "";
  }

  const attrRegex = /([a-zA-Z0-9_-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const kept: string[] = [];
  let hasTargetBlank = false;

  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(rawAttrs)) !== null) {
    const name = (match[1] ?? "").toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? "";

    if (!name || name.startsWith("on") || name === "style" || name === "srcdoc") {
      continue;
    }

    if (tag === "a") {
      if (name === "href" && isSafeUrl(val, true)) {
        kept.push(`href="${escapeAttr(val.trim())}"`);
      } else if (name === "title" && val) {
        kept.push(`title="${escapeAttr(val)}"`);
      } else if (name === "target" && (val === "_blank" || val === "_self")) {
        kept.push(`target="${escapeAttr(val)}"`);
        if (val === "_blank") {
          hasTargetBlank = true;
        }
      }
      continue;
    }

    if (tag === "img") {
      if (name === "src" && isSafeUrl(val, false)) {
        kept.push(`src="${escapeAttr(val.trim())}"`);
      } else if ((name === "alt" || name === "title") && val !== undefined) {
        kept.push(`${name}="${escapeAttr(val)}"`);
      } else if ((name === "width" || name === "height") && /^\d{1,4}$/.test(val.trim())) {
        kept.push(`${name}="${val.trim()}"`);
      }
      continue;
    }
  }

  if (tag === "a" && hasTargetBlank) {
    kept.push('rel="noopener noreferrer"');
  }

  return kept.length > 0 ? ` ${kept.join(" ")}` : "";
}

/**
 * Allowlist HTML sanitizer for community articles before rendering via `dangerouslySetInnerHTML`.
 */
export function sanitizeArticleHtml(input: string): string {
  if (!input) {
    return "";
  }

  let html = input.replace(/<!--[\s\S]*?-->/g, "");

  for (const tag of DROP_CONTAINER_TAGS) {
    const containerRegex = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    html = html.replace(containerRegex, "");
    const openOrCloseRegex = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
    html = html.replace(openOrCloseRegex, "");
  }

  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9:-]*)(\s[^<>]*)?\/?>/g, (fullMatch, rawTag: string, rawAttrs: string | undefined) => {
    const tag = rawTag.toLowerCase();
    const isClosing = fullMatch.startsWith("</");

    if (!ALLOWED_TAGS.has(tag)) {
      return "";
    }

    if (isClosing) {
      return VOID_TAGS.has(tag) ? "" : `</${tag}>`;
    }

    const attrs = sanitizeAttributes(tag, rawAttrs ?? "");
    if (tag === "img" && !attrs.includes('src="')) {
      return "";
    }

    return `<${tag}${attrs}>`;
  });
}
