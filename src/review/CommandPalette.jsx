import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

/** Ctrl K: every action in one searchable list, with its shortcut. */
export default function CommandPalette({ language, commands, onClose }) {
  const zh = language === 'zh';
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef(null);
  const needle = query.trim().toLocaleLowerCase();
  const items = useMemo(() => commands.filter((command) => !command.hidden && (!needle || `${command.label} ${command.group || ''} ${command.keywords || ''}`.toLocaleLowerCase().includes(needle))), [commands, needle]);
  useEffect(() => { setIndex(0); }, [needle]);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index]);

  function run(command) { if (!command || command.disabled) return; onClose(); window.setTimeout(() => command.run(), 0); }

  return <div className="modal-backdrop command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="command-palette" role="dialog" aria-modal="true" aria-label={zh ? '命令面板' : 'Command palette'}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        else if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((value) => Math.min(items.length - 1, value + 1)); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((value) => Math.max(0, value - 1)); }
        else if (event.key === 'Enter') { event.preventDefault(); run(items[index]); }
      }}>
      <label className="command-search"><Search size={16} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '输入要做的事，例如「导出」「对比」「深色」' : 'Type an action, e.g. "export", "compare", "dark"'} aria-label={zh ? '搜索命令' : 'Search commands'} />
      </label>
      <div className="command-list" role="listbox" ref={listRef}>
        {items.map((command, position) => <button key={command.id} role="option" aria-selected={position === index} disabled={command.disabled}
          className={position === index ? 'active' : ''} onMouseEnter={() => setIndex(position)} onClick={() => run(command)}>
          <span className="command-group">{command.group}</span><span className="command-label">{command.label}</span>{command.shortcut && <kbd>{command.shortcut}</kbd>}
        </button>)}
        {!items.length && <p className="empty-state">{zh ? '没有匹配的命令' : 'No matching command'}</p>}
      </div>
    </div>
  </div>;
}
