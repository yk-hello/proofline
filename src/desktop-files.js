const bridge = window.mengxDesktop;
const handles = new Map();

export function desktopHandle(record) {
  if (!record) return null;
  if (handles.has(record.id)) return handles.get(record.id);
  let baseline;
  const handle = {
    name: record.name, kind: record.kind, id: record.id, path: record.path, desktop: true,
    queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    isSameEntry: async (other) => other?.desktop && other.path.toLowerCase() === record.path.toLowerCase(),
    resourceUrl: (source) => {
      // Markdown parsers escape Unicode and spaces in image hrefs. Decode that
      // URL layer before wrapping the path in our capability URL.
      try { source = decodeURIComponent(source); } catch { /* keep literal percent signs */ }
      return `mengx-resource://${record.id}/${encodeURIComponent(source)}`;
    },
    getMetadata: () => bridge.metadata(record.id),
    getFile: async () => {
      const data = await bridge.read(record.id);
      const file = new File([data.bytes], record.name, { lastModified: data.lastModified });
      baseline = await file.text();
      return file;
    },
    createWritable: async () => {
      const expected = baseline;
      let source, aborted = false;
      return {
        write: async (value) => { source = value; },
        close: async () => { if (!aborted) { await bridge.write(record.id, source, expected); baseline = source; } },
        abort: async () => { aborted = true; },
      };
    },
    prepareRemoval: () => bridge.prepareTrash(record.id),
    remove: (token) => bridge.trash(record.id, token),
    values: async function* () { for (const entry of await bridge.list(record.id)) yield desktopHandle(entry); },
  };
  handles.set(record.id, handle);
  return handle;
}

export async function chooseDesktopFile(currentHandle) { return desktopHandle(await bridge.chooseFile(currentHandle?.id)); }
export async function chooseDesktopDirectory() { return desktopHandle(await bridge.chooseDirectory()); }
export async function restoreDesktopFile(key) { return desktopHandle(await bridge.restore(key)); }
export async function openDesktopPath(filename) { return desktopHandle(await bridge.openGrantedPath(filename)); }
export async function saveDesktopExport(name, blob) { return bridge.saveExport(name, await blob.arrayBuffer()); }
