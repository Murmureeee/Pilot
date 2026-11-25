// @env browser
import { useLayoutEffect, type RefObject } from "react";

import type { TranscriptLocation } from "@shared/contract";
import { literalMatches, transcriptPartKey } from "@shared/transcript-search";

function matchingRange(element: HTMLElement, term: string, occurrence: number): Range | undefined {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest("[hidden], [aria-hidden=true]")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
    text += node.textContent;
  }
  const match = Iterator.from(literalMatches(text, term)).drop(occurrence).next().value;
  if (!match) return undefined;
  const end = match.index + match[0].length;
  const range = document.createRange();
  let offset = 0;
  for (const node of nodes) {
    const next = offset + node.length;
    if (offset <= match.index && match.index < next) range.setStart(node, match.index - offset);
    if (offset < end && end <= next) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset = next;
  }
  return undefined;
}

function center(outer: Element, rect: DOMRect): void {
  const viewport = outer.getBoundingClientRect();
  outer.scrollTop += rect.top - viewport.top + (rect.height - outer.clientHeight) / 2;
}

export function useTranscriptLocation(
  viewportRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  query: string,
  location?: TranscriptLocation,
): void {
  const key = location && transcriptPartKey(location.messageId, location.partIndex);
  const field = location?.field;
  const occurrence = location?.occurrence ?? 0;
  useLayoutEffect(() => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    const term = query.trim();
    if (!key || !content || !viewport || !term) return;
    const element = content.querySelector<HTMLElement>(
      `[data-transcript-part="${CSS.escape(key)}"]`,
    );
    if (!element) return;
    element.dataset.chatFindCurrent = "";
    let selectionFrame = 0;
    const frame = requestAnimationFrame(() => {
      center(viewport, element.getBoundingClientRect());
      selectionFrame = requestAnimationFrame(() => {
        const fields = element.querySelectorAll<HTMLElement>(`[data-transcript-field="${field}"]`);
        const targets = fields.length ? [...fields] : [element];
        const range = targets
          .map((target) => matchingRange(target, term, occurrence))
          .find(Boolean);
        if (!range) return;
        CSS.highlights?.set("pilot-chat-find", new Highlight(range));
        for (
          let parent = range.startContainer.parentElement;
          parent && parent !== viewport;
          parent = parent.parentElement
        ) {
          if (
            parent.scrollHeight > parent.clientHeight &&
            /(auto|scroll)/.test(getComputedStyle(parent).overflowY)
          )
            center(parent, range.getBoundingClientRect());
        }
        center(viewport, range.getBoundingClientRect());
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(selectionFrame);
      CSS.highlights?.delete("pilot-chat-find");
      delete element.dataset.chatFindCurrent;
    };
  }, [viewportRef, contentRef, key, field, occurrence, query]);
}
