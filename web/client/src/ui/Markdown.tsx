/** Markdown del asistente: marked + DOMPurify (nada de HTML sin sanear llega al DOM). */
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { memo, useMemo } from "react";

const md = new Marked({ gfm: true, breaks: true });

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  }
});

export function sanitize(html: string, extra?: { allowImages?: boolean }) {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed", ...(extra?.allowImages ? [] : ["img"])],
    FORBID_ATTR: ["style", "class", "id"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i,
  });
}

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const html = useMemo(() => sanitize(md.parse(text, { async: false }) as string), [text]);
  return <div className={`md ${streaming ? "is-streaming" : ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
});
