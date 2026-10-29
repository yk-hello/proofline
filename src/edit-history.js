export class EditHistory {
  constructor() {
    this.past = [];
    this.future = [];
    this.group = null;
    this.lastAt = 0;
  }

  record(before, { group = null } = {}) {
    const now = performance.now();
    if (!group || group !== this.group || now - this.lastAt > 650 || this.future.length) this.past.push(before);
    this.future = [];
    this.group = group;
    this.lastAt = now;
    this.trim();
  }

  trim() {
    while (this.past.length > 80) this.past.shift();
    // Shared source strings count once; long documents are not copied per keystroke.
    const bytes = () => {
      const strings = new Set();
      for (const snapshot of this.past) {
        strings.add(snapshot.markdown || '');
        if (snapshot.html) strings.add(snapshot.html);
        for (const draft of snapshot.chunks?.values() || []) strings.add(draft.html ?? draft.source ?? '');
      }
      return [...strings].reduce((total, value) => total + value.length * 2, 0);
    };
    while (this.past.length > 1 && bytes() > 24 * 1024 * 1024) this.past.shift();
  }

  undo(current) {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(current);
    this.group = null;
    return previous;
  }

  redo(current) {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    this.group = null;
    return next;
  }
}

export function captureEditSelection(root) {
  const selection = window.getSelection();
  if (!selection?.anchorNode || !root?.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
  const region = selection.anchorNode.parentElement?.closest('[data-edit-region]');
  if (!region || !region.contains(selection.focusNode)) return null;
  const offset = (node, position) => {
    const range = document.createRange();
    range.selectNodeContents(region);
    range.setEnd(node, position);
    return range.toString().length;
  };
  return { region: region.dataset.editRegion, anchor: offset(selection.anchorNode, selection.anchorOffset), focus: offset(selection.focusNode, selection.focusOffset) };
}

export function restoreEditSelection(root, saved) {
  if (!saved || !root) return false;
  const region = root.querySelector(`[data-edit-region="${CSS.escape(saved.region)}"]`) || (root.dataset.editRegion === saved.region ? root : null);
  if (!region) return false;
  const at = (offset) => {
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    let node, last;
    while ((node = walker.nextNode())) {
      last = node;
      if (offset <= node.textContent.length) return [node, offset];
      offset -= node.textContent.length;
    }
    return last ? [last, last.textContent.length] : [region, 0];
  };
  region.focus({ preventScroll: true });
  const [anchor, anchorOffset] = at(saved.anchor), [focus, focusOffset] = at(saved.focus);
  window.getSelection()?.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
  return true;
}
