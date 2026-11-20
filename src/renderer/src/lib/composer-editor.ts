// @env browser
import type { ComposerDraft, PromptMention } from "@shared/contract";
import { composerTrigger } from "./composer-shortcuts";
import type { ComposerSelection } from "./composer/types";

export function mentionKey(mention: PromptMention): string {
  return JSON.stringify([
    mention.type,
    mention.id,
    mention.type === "skill" ? null : mention.meta.workingDirectory,
  ]);
}

function mentionNode(
  mention: PromptMention,
  resources: Map<string, PromptMention>,
): HTMLSpanElement {
  const key = mentionKey(mention);
  resources.set(key, mention);
  const chip = document.createElement("span");
  chip.className = "composer-mention workspace-reference workspace-reference-chip";
  chip.contentEditable = "false";
  chip.draggable = false;
  chip.dataset.mention = key;
  chip.dataset.referenceKind = mention.type;
  chip.title = mention.type === "skill" ? mention.meta.description || mention.label : mention.id;
  chip.textContent = mention.label;
  return chip;
}

export function restoreComposerDraft(
  editor: HTMLDivElement,
  draft: ComposerDraft,
  resources: Map<string, PromptMention>,
): void {
  editor.replaceChildren(
    ...draft.map((part) => (typeof part === "string" ? part : mentionNode(part, resources))),
  );
}

export function readComposerDraft(
  editor: HTMLDivElement,
  resources: ReadonlyMap<string, PromptMention>,
): ComposerDraft {
  const parts: ComposerDraft = [];
  function read(parent: HTMLElement): void {
    let previous: Node | null = null;
    let previousBlock = false;
    for (const child of parent.childNodes) {
      // Chromium leaves a trailing <br> to hold the caret on an empty line.
      if (
        (child instanceof HTMLBRElement && child === parent.lastChild) ||
        (child instanceof Text && !child.length)
      )
        continue;
      const block = child instanceof HTMLDivElement || child instanceof HTMLParagraphElement;
      if (previous !== null && (previousBlock || (block && !(previous instanceof HTMLBRElement)))) {
        parts.push("\n");
      }
      if (child instanceof Text) {
        parts.push(child.data.replaceAll("\u00a0", " "));
      } else if (child instanceof HTMLBRElement) {
        parts.push("\n");
      } else if (child instanceof HTMLElement) {
        const mention = resources.get(child.dataset.mention ?? "");
        if (mention && child.contentEditable === "false") parts.push(mention);
        else read(child);
      }
      previous = child;
      previousBlock = block;
    }
  }
  read(editor);
  return parts;
}

export function composerRange(editor: HTMLDivElement): Range | null {
  const selection = document.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return editor.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
}

export function readComposerSelection(editor: HTMLDivElement, caret: Range): ComposerSelection {
  const state: ComposerSelection = { element: editor, caret, trigger: null };
  if (!caret.collapsed) return state;

  const { startContainer, startOffset } = caret;
  const preceding = startContainer.childNodes[startOffset - 1];
  const following = startContainer.childNodes[startOffset];
  const node =
    startContainer instanceof Text
      ? startContainer
      : preceding instanceof Text
        ? preceding
        : following;
  if (!(node instanceof Text) || node.parentElement?.closest("[contenteditable=false]"))
    return state;

  let first = node;
  while (first.previousSibling instanceof Text) first = first.previousSibling;
  const nodes: Text[] = [];
  let text = "";
  let offset = 0;
  for (let current: Node | null = first; current instanceof Text; current = current.nextSibling) {
    if (current === node) {
      offset =
        text.length +
        (startContainer === node ? startOffset : preceding === node ? node.length : 0);
    }
    text += current.data;
    nodes.push(current);
  }
  const trigger = composerTrigger(text, offset, offset);
  if (!trigger) return state;

  const pointAt = (index: number): [Text, number] => {
    for (const textNode of nodes) {
      if (index <= textNode.length) return [textNode, index];
      index -= textNode.length;
    }
    return [node, node.length];
  };
  const range = caret.cloneRange();
  range.setStart(...pointAt(trigger.start));
  range.setEnd(...pointAt(trigger.end));
  return { ...state, trigger: { ...trigger, range } };
}

export function selectComposerRange(editor: HTMLDivElement, range: Range | null): void {
  editor.focus({ preventScroll: true });
  const selection = document.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  if (range && editor.contains(range.commonAncestorContainer)) selection.addRange(range);
  else selection.collapse(editor, editor.childNodes.length);
}

export function insertComposerMention(
  editor: HTMLDivElement,
  range: Range | null,
  mention: PromptMention,
  resources: Map<string, PromptMention>,
): void {
  selectComposerRange(editor, range);
  // Chromium's editing command puts the inline replacement in the native undo history.
  document.execCommand("insertHTML", false, mentionNode(mention, resources).outerHTML);
  const selection = document.getSelection();
  const chip = selection?.anchorNode?.parentElement?.closest("[data-mention]");
  if (chip?.parentNode && editor.contains(chip)) {
    // When a chip ends the line, Chromium can leave the caret inside its locked label.
    const after = document.createRange();
    after.setStartAfter(chip);
    after.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(after);
  }
}
