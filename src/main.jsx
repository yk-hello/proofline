import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import mammoth from 'mammoth/mammoth.browser';
import { useDocumentPreparation, needsProgressiveReading } from './use-document-preparation';
import LargeDocumentView from './LargeDocumentView';
import EditableMarkdown from './EditableMarkdown';
import { EditHistory, captureEditSelection, restoreEditSelection } from './edit-history';
import { DocumentWriter } from './document-writer';
import { desktopHandle, chooseDesktopFile, chooseDesktopDirectory, restoreDesktopFile, openDesktopPath, saveDesktopExport } from './desktop-files';
import { VirtualList } from './VirtualList';
import { useReaderApi, waitForReader, pageOf, API_VERSION } from './use-reader-api';
import { createTextAnchor, resolveTextAnchor, captureReadingSelection, findRenderedAnchor, paintReadingHighlights, clearReadingHighlights, hitTestMarks, paintRoundChanges, clearRoundChanges } from './reading-annotations';
import { markStore, isRedline, numberRedlines, MARK_TYPES, REDLINE_STATUS, serializeSidecar } from './review/marks';
import { roundRecord, composeReview, changeRisks, buildTasks, buildPrompt, parseReply, applyPatches, extractFullDocument, splitBlocks, blockAt, anchorDocument, resolveAnchors, stripAnchors, hiddenContent, diffBlocks, rebaseChanges, positionHint, anchorOpen, anchorClose, tasksForHunk } from '../electron/review-core.mjs';
import { t as rt, typeLabel } from './review/copy';
import { readAgentSettings, restoreAgentSettings } from './review/agents';
import MarkPopover from './review/MarkPopover';
import InstructionRail from './review/InstructionRail';
import SendDialog from './review/SendDialog';
import ManualTransfer from './review/ManualTransfer';
import ReviewView from './review/ReviewView';
import ChangePopover from './review/ChangePopover';
import { diffArrays } from 'diff';
import RunPanel from './review/RunPanel';
import AgentSettings from './review/AgentSettings';
import MarkdownEditor from './review/MarkdownEditor';
import { editableParts, partAt } from './review/sections';
import SetupWizard from './review/SetupWizard';
import HistoryPanel from './review/HistoryPanel';
import CommandPalette from './review/CommandPalette';
import { findMathMatches } from './math-matches';
import { DEFAULT_SEARCH_OPTIONS, normalizeSearchOptions, searchExpression, textMatches } from './search';
import { findEditorMatches, paintEditorMatches, clearEditorMatches, revealRange } from './editor-search';
import { hydrateWidgets } from './charts';
import { enhanceTables, sortTable, totalRowMarkdown, appendTableRow, documentStats } from './table-tools';
import StatsDialog from './review/StatsDialog';
import { getRecovery, storeRecovery, recoveryVersions, storePendingReview, versionSource } from './document-recovery';
import ImageViewer from './ImageViewer';
import {
  AlignLeft,
  BookOpen,
  Bookmark,
  Copy,
  Highlighter,
  Underline,
  MessageCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Download,
  Eraser,
  FileCode2,
  FileDown,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  LayoutPanelLeft,
  Maximize2,
  Minus,
  MoreHorizontal,
  PanelLeftClose,
  PanelRight,
  PencilLine,
  Plus,
  Search,
  Settings2,
  Redo2,
  RefreshCw,
  Scissors,
  Square,
  Split,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import './shell.css';
import './content.css';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource/inter-tight/latin-500.css';
import '@fontsource/inter-tight/latin-700.css';
import '@fontsource/inter-tight/latin-900.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import 'katex/dist/katex.min.css';
import { htmlDocumentToMarkdown, htmlToMarkdown } from './lib/turndown';
import { DOCUMENT_EXTENSIONS, READING_PREFERENCE_DEFAULTS, normalizeReadingPreferences, readReadingPreferences, readReadingWidth } from './lib/preferences';
import { DEMO_DOCUMENT, REFERENCE_DOCUMENT, REFERENCE_RELEASE } from './lib/demo';
import { DEMO_DOCUMENT_EN, startLanguage, startSample } from './lib/demo-en';
// A Markdown passage as the text a reader sees.
const plainText = (markdown) => { const holder = document.createElement('div'); holder.innerHTML = safeMarkdown(markdown, '', () => ''); return holder.textContent || ''; };
// The sample the app opens with, in the interface language it starts in.
const START = startSample();
import { UI } from './lib/i18n';
import { headingSlug, normalizeResourceKey, documentCacheKey, safeMarkdown } from './lib/render';
import { textAlignFor, shortPath, formatBytes, formatKindLabel, formatRecentTime, formatRecentPath, documentSummary, lightDocumentTitle, yieldToBrowser } from './lib/format';
import { persistFileHandle, restoreFileHandle, forgetFileHandle } from './lib/handles';

// Absolute paths on this computer: C:\... on Windows, /... on macOS and Linux desktops.
function isNativePath(value) {
  if (typeof value !== 'string') return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  return Boolean(window.mengxDesktop && window.mengxDesktop.platform !== 'win32' && value.startsWith('/'));
}

function App() {
  const initialKey = documentCacheKey(START.name, START.path);
  const [tabs, setTabs] = useState([{ id: initialKey, name: START.name, path: START.path, kind: 'MD' }]);
  const tabsRef = useRef(tabs);
  const tabSessionsRef = useRef(new Map());
  const closedTabsRef = useRef([]);
  const [closeTabConfirmation, setCloseTabConfirmation] = useState(null);
  const [tabVersion, setTabVersion] = useState(0);
  const openRequestRef = useRef(0);
  const startupRef = useRef(null);
  const [restoringSession, setRestoringSession] = useState(true);
  const navigationHistoryRef = useRef({ back: [], forward: [] });
  const navigatingHistoryRef = useRef(false);
  const [navigationVersion, setNavigationVersion] = useState(0);
  const [railMode, setRailMode] = useState('redlines');
  const [sideMode, setSideMode] = useState(() => ['files', 'history'].includes(localStorage.getItem('redline-side-mode')) ? localStorage.getItem('redline-side-mode') : 'contents');
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Light, dark, or whatever the system uses.
  const [theme, setTheme] = useState(() => { try { const value = localStorage.getItem('stetwise-theme'); return ['light', 'dark', 'system'].includes(value) ? value : 'system'; } catch { return 'system'; } });
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && Boolean(media?.matches));
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      void window.mengxDesktop?.setTheme?.(theme)?.catch?.(() => {});
    };
    apply();
    try { localStorage.setItem('stetwise-theme', theme); } catch { /* optional */ }
    media?.addEventListener?.('change', apply);
    return () => media?.removeEventListener?.('change', apply);
  }, [theme]);
  const [markPopover, setMarkPopover] = useState(null);
  const [undoToast, setUndoToast] = useState(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(() => {
    try { return Boolean(window.mengxDesktop?.system) && !localStorage.getItem('redline-setup-v1'); } catch { return false; }
  });
  function closeSetup() { try { localStorage.setItem('redline-setup-v1', String(Date.now())); } catch { /* optional */ } setSetupOpen(false); }
  const [agentRun, setAgentRun] = useState(null);
  const agentRunRef = useRef(null);
  const agentStartingRef = useRef(false);
  const [review, setReview] = useState(null);
  const [manualTransfer, setManualTransfer] = useState(null);
  useEffect(() => {
    void window.mengxDesktop?.system?.storageStatus().then((state) => {
      if (!state.writable) setNotice((language === 'zh' ? '数据目录无法写入，请在 AI 工具设置中选择保存位置：' : 'Choose writable storage in AI settings: ') + state.path);
      else if (state.fallbackFrom) setNotice(language === 'zh' ? `安装目录不能写入，标记改存到 ${state.path}。可在 AI 工具设置中更换位置。` : `The install folder is read-only; marks are saved in ${state.path}. Change it in AI settings.`);
    }).catch((error) => setNotice(error.message));
  }, []);
  const reviewRef = useRef(null);
  // The last change applied to the document as a whole (outside program, review, revert):
  // shown as a bar with Compare and Undo, which also work in reading mode.
  const [round, setRound] = useState(null);
  // The round of changes shown in the text (see paintRoundChanges), and the one that was clicked.
  const roundChangesRef = useRef([]);
  const [changePopover, setChangePopover] = useState(null);
  // Reviews an AI in a terminal is waiting for (stetwise-review <file>): { folder, path }.
  const [terminalReviews, setTerminalReviews] = useState([]);
  useEffect(() => window.mengxDesktop?.onReviewRequest?.((request) => setTerminalReviews((list) => [...list.filter((item) => item.folder !== request.folder), request])), []);
  const roundRef = useRef(null);
  const [pendingReview, setPendingReview] = useState(null);
  const reviewProgressTimerRef = useRef(null);
  const [compareView, setCompareView] = useState(null);
  const flashTimerRef = useRef(null);
  const [actionToast, setActionToast] = useState(null);
  const [pdfOptions, setPdfOptions] = useState(null);
  const agentEventsRef = useRef({});
  const [editorKey, setEditorKey] = useState(0);
  const [richPart, setRichPart] = useState(null);
  const richPartRef = useRef(null);
  function resetRichEditor() { richPartRef.current = null; setRichPart(null); setEditorKey((value) => value + 1); }
  const editorDraftRef = useRef(null);
  const editorRef = useRef(null);
  const paintedMarksRef = useRef([]);
  const [annotationQuery, setAnnotationQuery] = useState('');
  const [sourceView, setSourceView] = useState(false);
  const sourceTransitionRef = useRef(null);
  const focusOutlineRef = useRef(null);
  const [annotationVersion, setAnnotationVersion] = useState(0);
  const annotationHistoriesRef = useRef(new Map());
  const [activeAnnotation, setActiveAnnotation] = useState(null);
  const [selectionTools, setSelectionTools] = useState(null);
  const [selectionContextMenu, setSelectionContextMenu] = useState(null);
  const selectedPassageRef = useRef(null);
  const [noteDialog, setNoteDialog] = useState(null);
  const [annotationLabelDraft, setAnnotationLabelDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [markdown, setMarkdown] = useState(START.document);
  const [fileName, setFileName] = useState(START.name);
  const [fileMeta, setFileMeta] = useState({ size: 4820, source: START.path, updated: 'just-now', kind: 'MD' });
  const [recentFiles, setRecentFiles] = useState(START.recents);
  const [workspaceFiles, setWorkspaceFiles] = useState([]);
  const [language, setLanguage] = useState(startLanguage);
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('mengx-sidebar-open') !== 'false');
  const [outlineOpen, setOutlineOpen] = useState(() => localStorage.getItem('mengx-focus-reading') !== 'true' && localStorage.getItem('mengx-outline-open') !== 'false');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchNavigation, setSearchNavigation] = useState(0);
  const [searchOptions, setSearchOptions] = useState(DEFAULT_SEARCH_OPTIONS);
  const [searchOptionsDraft, setSearchOptionsDraft] = useState(DEFAULT_SEARCH_OPTIONS);
  const [searchError, setSearchError] = useState('');
  const [workspaceSearch, setWorkspaceSearch] = useState(null);
  const [editorMatches, setEditorMatches] = useState([]);
  const workspaceSearchRequestRef = useRef(0);
  const workspaceSearchCancelRef = useRef(null);
  const [quickQuery, setQuickQuery] = useState('');
  const [pathOpen, setPathOpen] = useState(false);
  const [documentMenuOpen, setDocumentMenuOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const tableActionsRef = useRef(null);
  const [readingMode, setReadingMode] = useState(true);
  const [referenceName, setReferenceName] = useState('阅读器架构.txt');
  const [referenceMarkdown, setReferenceMarkdown] = useState(REFERENCE_DOCUMENT);
  const [referenceMeta, setReferenceMeta] = useState(null);
  const [activeOutline, setActiveOutline] = useState('');
  const [outlineFocus, setOutlineFocus] = useState('');
  const [splitView, setSplitView] = useState(false);
  const [notice, setNotice] = useState('');
  const [lightbox, setLightbox] = useState(null);
  const [versionDialog, setVersionDialog] = useState(null);
  const [versionToRestore, setVersionToRestore] = useState(null);
  const [conflictDialog, setConflictDialog] = useState(false);
  const [conflictBusy, setConflictBusy] = useState(false);
  const externalMetadataRef = useRef(new Map());
  const checkingExternalRef = useRef(false);
  const checkExternalRef = useRef(null);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [collapsedHeadings, setCollapsedHeadings] = useState(() => new Set());
  const [readingProgress, setReadingProgress] = useState(0);
  const lastReadPositionRef = useRef(null);
  const [splitSync, setSplitSync] = useState(false);
  const referenceScrollRef = useRef(null);
  const referenceArticleRef = useRef(null);
  const referenceRestoreRef = useRef(null);
  const referenceNavigationRef = useRef(null);
  const splitSyncingRef = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => Math.max(220, Math.min(480, Number(localStorage.getItem('mengx-sidebar-width')) || 270)));
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [locationSuggestionIndex, setLocationSuggestionIndex] = useState(-1);
  const [locationFocused, setLocationFocused] = useState(false);
  const sidebarResizeRef = useRef(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [readingWidth, setReadingWidth] = useState(() => window.localStorage.getItem('morrow-reading-width') || 'comfortable');
  const [readingPreferences, setReadingPreferences] = useState(() => readReadingPreferences(START.name));
  const [focusMode, setFocusMode] = useState(() => window.localStorage.getItem('mengx-focus-reading') === 'true');
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [locationDraft, setLocationDraft] = useState('');
  const [pdfProgress, setPdfProgress] = useState(null);
  const pdfWorkerRef = useRef(null);
  const pdfCancelRef = useRef(false);
  const pdfBusyRef = useRef(false);
  const documentRevisionRef = useRef(0);
  const chunkDraftsRef = useRef(new Map());
  const dirtyDocumentsRef = useRef(new Map());
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState({ status: 'idle' });
  const [historyVersion, setHistoryVersion] = useState(0);
  const [openGeneration, setOpenGeneration] = useState(0);
  const [recentMenu, setRecentMenu] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const deleteCandidateRef = useRef(null);
  const editHistoriesRef = useRef(new Map());
  const editVersionsRef = useRef(new Map());
  const beforeInputRef = useRef(null);
  const sourceBaseRef = useRef(START.document);
  const lastEditSnapshotRef = useRef({ markdown: START.document, html: null, chunks: new Map(), selection: null });
  const autoSaveTimerRef = useRef(null);
  const autoSaveHandlerRef = useRef(null);
  const writerChangeRef = useRef(null);
  const writerRef = useRef(null);
  if (!writerRef.current) writerRef.current = new DocumentWriter((key, state) => writerChangeRef.current?.(key, state));
  const performanceRef = useRef({ opens: [], currentOpen: null, pdfJobs: [], longTasks: [], errors: [] });
  const [headingTarget, setHeadingTarget] = useState(null);
  const [workspaceRootName, setWorkspaceRootName] = useState('');
  const [expandedWorkspaceFolders, setExpandedWorkspaceFolders] = useState(() => new Set());
  const [desktopFolders, setDesktopFolders] = useState(() => new Map());
  const desktopFolderLoadsRef = useRef(new Map());
  const fileInputRef = useRef(null);
  const splitFileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const quickInputRef = useRef(null);
  const articleRef = useRef(null);
  const readingNavigationRef = useRef(null);
  const restoringPositionRef = useRef(false);
  const readingScrollRef = useRef(null);
  const draftHtmlRef = useRef(null);
  const savedRef = useRef(true);
  const fileHandlesRef = useRef(new Map());
  const directoryHandleRef = useRef(null);
  const fileContentsRef = useRef(new Map([
    [normalizeResourceKey('欢迎使用 Stetwise.md'), DEMO_DOCUMENT],
    [normalizeResourceKey('Welcome to Stetwise.md'), DEMO_DOCUMENT_EN],
    [normalizeResourceKey('安静的界面设计.md'), DEMO_DOCUMENT],
    [normalizeResourceKey('发布说明.md'), REFERENCE_RELEASE],
    [normalizeResourceKey('阅读器架构.txt'), REFERENCE_DOCUMENT],
    [normalizeResourceKey('排版检查清单.md'), '# 排版检查清单\n\n- 正文宽度保持稳定\n- 表格和代码允许横向展开\n- 图片使用相对路径并支持放大查看'],
  ]));
  const assetMapRef = useRef(new Map());
  const assetUrlsRef = useRef([]);
  const scrollPositionsRef = useRef(null);
  const readingPositionCacheRef = useRef(null);
  const referencePositionCacheRef = useRef(null);
  const restoredGenerationRef = useRef(-1);
  const [assetVersion, setAssetVersion] = useState(0);
  const copy = UI[language] || UI.zh;
  const desktopWindow = Boolean(window.mengxDesktop);
  // Inject the system accent color as a CSS custom property so focus rings and
  // active states match the user's Windows theme instead of a hardcoded neutral.
  useEffect(() => {
    if (!desktopWindow) return;
    window.mengxDesktop.getAccentColor?.().then((color) => {
      if (color) document.documentElement.style.setProperty('--sys-accent', color);
    }).catch(() => {});
  }, [desktopWindow]);
  const minimizeWindow = () => { if (desktopWindow) void window.mengxDesktop.minimizeWindow(); };
  const toggleWindowMaximize = async () => {
    if (!desktopWindow) return;
    try { const result = await window.mengxDesktop.toggleMaximize(); setWindowMaximized(Boolean(result?.maximized)); }
    catch (error) { console.error(error); }
  };
  const closeWindow = () => { if (desktopWindow) void window.mengxDesktop.closeWindow(); };

  const currentDocumentKey = documentCacheKey(fileName, fileMeta.source);
  const preferenceDocumentRef = useRef(currentDocumentKey);
  const activeDocumentRef = useRef({ key: currentDocumentKey, name: fileName, path: fileMeta.source, kind: fileMeta.kind });
  const history = editHistoriesRef.current.get(currentDocumentKey);
  const canUndo = !readingMode && Boolean(history?.past.length);
  const canRedo = !readingMode && Boolean(history?.future.length);
  const saveLabel = ({ pending: copy.autosavePending, saving: copy.autosaving, saved: copy.autosaved,
    session: copy.sessionOnly, permission: copy.permissionRequired, error: copy.saveFailed, conflict: copy.fileConflict })[saveState.status];

  writerChangeRef.current = (key, state) => {
    const latest = (editVersionsRef.current.get(key) || 0) === state.version;
    if (state.status === 'saved') {
      void storeRecovery(key, state.source, { saved: true, coalesceMs: 60000 }).catch(() => setNotice(language === 'zh' ? '版本备份未完成；原文件已保存' : 'Source saved; version backup unavailable'));
      fileContentsRef.current.set(key, state.source);
      if (latest) dirtyDocumentsRef.current.delete(key);
    }
    const session = tabSessionsRef.current.get(key);
    if (session && state.status === 'saved' && latest) session.saved = true;
    setTabVersion((value) => value + 1);
    if (activeDocumentRef.current.key !== key) return;
    if (state.status === 'saved' && !latest) return;
    setSaveState(state);
    if (state.status === 'saved' && latest) {
      setDirtyMarkers(true);
      setFileMeta((meta) => ({ ...meta, size: new Blob([state.source]).size, updated: 'saved-just-now' }));
    }
  };
  autoSaveHandlerRef.current = () => saveCurrentFile({ automatic: true });
  checkExternalRef.current = checkExternalChanges;

  async function checkExternalChanges({ force = true } = {}) {
    const { key, kind } = activeDocumentRef.current;
    const handle = fileHandlesRef.current.get(key), writer = writerRef.current;
    if (!handle || !['MD', 'TXT'].includes(kind) || checkingExternalRef.current || writer.jobs.has(key) || writer.blocked.has(key)) return { ok: true, skipped: true };
    checkingExternalRef.current = true;
    const baseline = writer.baselines.get(key);
    try {
      let stamp, file;
      if (handle.getMetadata) stamp = JSON.stringify(await handle.getMetadata());
      else { file = await handle.getFile(); stamp = `${file.lastModified}:${file.size}`; }
      if (!force && externalMetadataRef.current.get(key) === stamp) return { ok: true, changed: writer.states.get(key)?.status === 'conflict' };
      const disk = await (file || await handle.getFile()).text();
      if (writer.jobs.has(key) || writer.baselines.get(key) !== baseline) return { ok: true, skipped: true };
      externalMetadataRef.current.set(key, stamp);
      const changed = baseline !== undefined && disk !== baseline;
      const run = agentRunRef.current;
      // An agent run in folder scope edits the original file; its result is reviewed when it finishes.
      if (changed && run?.key === key && run.scope === 'folder' && ['starting', 'running'].includes(run.status)) return { ok: true, changed, agent: true };
      if (changed) editorRef.current?.flush();
      if (changed && isDocumentClean(key) && !reviewRef.current) {
        // Nothing unsaved here: follow the file. The bar offers Compare and Undo.
        followExternalChange(key, handle, disk);
        return { ok: true, changed, followed: true };
      }
      if (changed) writer.change(key, { status: 'conflict', version: editVersionsRef.current.get(key) || 0, error: 'external-file-change' });
      return { ok: true, changed };
    } catch (error) {
      if (!writer.jobs.has(key)) writer.change(key, { status: 'error', version: editVersionsRef.current.get(key) || 0, error: 'file-unavailable' });
      return { ok: false, error: 'file-unavailable', message: error.message };
    } finally { checkingExternalRef.current = false; }
  }

  useEffect(() => {
    const check = () => { if (document.visibilityState !== 'hidden') void checkExternalRef.current?.({ force: false }); };
    const timer = setInterval(check, 2500);
    window.addEventListener('focus', check);
    const initial = setTimeout(check, 400);
    return () => { clearInterval(timer); clearTimeout(initial); window.removeEventListener('focus', check); };
  }, [currentDocumentKey]);

  useEffect(() => markStore.subscribe((key) => { if (key === activeDocumentRef.current.key) setAnnotationVersion((value) => value + 1); }), []);
  useEffect(() => {
    // Agents and the MCP server may update the sidecar while Stetwise is open.
    const reload = () => { if (document.visibilityState !== 'hidden' && activeDocumentRef.current.key) void markStore.reload(activeDocumentRef.current.key); };
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, []);

  function setDirtyMarkers(isSaved) {
    savedRef.current = isSaved;
    setDirty(!isSaved);
  }

  function clearAssetUrls() {
    assetUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    assetUrlsRef.current = [];
    assetMapRef.current = new Map();
  }

  function resolveDocumentAsset(source, handle = fileHandlesRef.current.get(currentDocumentKey)) {
    return handle?.desktop ? handle.resourceUrl(source) : assetMapRef.current.get(normalizeResourceKey(source));
  }

  async function saveDocumentImage(file) {
    if (!file || file.size > 16 * 1024 * 1024) throw new Error(language === 'zh' ? '图片必须小于 16 MB' : 'Images must be smaller than 16 MB');
    const handle = fileHandlesRef.current.get(activeDocumentRef.current.key);
    if (handle?.desktop && window.mengxDesktop?.saveImage) {
      const saved = await window.mengxDesktop.saveImage(handle.id, await file.arrayBuffer());
      if (!saved.ok) throw new Error(saved.error || 'Image save failed');
      setNotice(language === 'zh' ? '图片已保存到文档旁的资源文件夹' : 'Image saved beside the document');
      return saved.source;
    }
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
  }

  function getReaderState() {
    return {
      version: API_VERSION,
      language,
      document: {
        name: fileName,
        path: fileMeta.source || '',
        kind: fileMeta.kind || 'MD',
        size: fileMeta.size || 0,
        revision: documentRevisionRef.current,
        contentLength: markdown.length,
        dirty,
        saveState: { status: saveState.status, error: saveState.error || null },
        canUndo,
        canRedo,
        canSave: ['MD', 'TXT'].includes(fileMeta.kind) && fileHandlesRef.current.has(currentDocumentKey),
        title: documentTitle,
        ready: documentAnalysis.ready && !restoringSession,
        progressive: isLargeDocument,
        progress: documentAnalysis.progress,
        wordCount: documentAnalysis.wordCount,
        outlineCount: outline.length,
        searchQuery: searchQuery || '',
        searchMatches: searchCount,
        searching: documentAnalysis.searching,
        activeMatch: searchCount ? searchIndex : null,
        activeHeading: activeOutline,
      },
      ui: {
        sidebarOpen,
        sidebarWidth,
        outlineOpen,
        searchOpen,
        splitView,
        readingMode,
        readingWidth,
        readingPreferences,
        focusMode,
        sourceView,
        preferencesOpen,
        helpOpen,
        railMode,
        canGoBack: navigationHistoryRef.current.back.length > 0,
        canGoForward: navigationHistoryRef.current.forward.length > 0,
        closeTabConfirmation: closeTabConfirmation?.id || null,
        deleteConfirmation: deleteConfirmation ? { token: deleteConfirmation.token, name: deleteConfirmation.file.name, path: deleteConfirmation.file.path } : null,
      },
      workspace: { name: workspaceRootName, fileCount: workspaceFiles.length },
      reference: splitView ? { name: referenceName, ready: referenceAnalysis.ready, kind: referenceMeta?.kind || 'MD' } : null,
      pdf: pdfProgress ? { ...pdfProgress, busy: true } : { busy: false },
      tabs: getTabs(),
      annotations: { count: markStore.get(currentDocumentKey).length, activeId: activeAnnotation,
        canUndo: Boolean(annotationHistoriesRef.current.get(currentDocumentKey)?.past.length),
        canRedo: Boolean(annotationHistoriesRef.current.get(currentDocumentKey)?.future.length) },
      navigation: { progress: readingProgress, activeHeading: activeOutline, collapsed: [...collapsedHeadings], position: getReadingPosition() },
      search: { options: searchOptions, error: searchError || documentAnalysis.searchError || null, scope: searchOptions.scope, pending: workspaceSearch?.pending || documentAnalysis.searching },
      recoveryAvailable,
      split: { open: splitView, sync: splitSync, right: splitView ? { name: referenceName, path: referenceMeta?.path, position: getReferencePosition() } : null },
    };
  }

  function updateTabs(next) {
    tabsRef.current = next;
    setTabs(next);
    persistTabs();
  }

  function persistTabs() {
    const native = tabsRef.current.filter((tab) => isNativePath(tab.path));
    localStorage.setItem('mengx-tabs-v1', JSON.stringify({ tabs: native, activeId: activeDocumentRef.current.key }));
  }

  function getTabs() {
    return tabsRef.current.map((tab) => ({ ...tab, active: tab.id === activeDocumentRef.current.key,
      dirty: tab.id === activeDocumentRef.current.key ? !savedRef.current : dirtyDocumentsRef.current.has(tab.id),
      saveState: writerRef.current.states.get(tab.id)?.status || (tab.id === activeDocumentRef.current.key ? saveState.status : 'idle') }));
  }

  function checkpointTab() {
    if (!tabsRef.current.some((tab) => tab.id === activeDocumentRef.current.key)) return;
    editorRef.current?.flush();
    if (editorDraftRef.current !== null) commitInlineEdit({ lock: false, notify: false });
    rememberReadingPosition();
    flushAutomaticSave();
    const source = getDocumentSource();
    fileContentsRef.current.set(activeDocumentRef.current.key, source);
    if (!savedRef.current) dirtyDocumentsRef.current.set(activeDocumentRef.current.key, source);
    tabSessionsRef.current.set(activeDocumentRef.current.key, { ...activeDocumentRef.current,
      source: sourceBaseRef.current, html: draftHtmlRef.current, chunks: new Map(chunkDraftsRef.current),
      snapshot: lastEditSnapshotRef.current, meta: { ...fileMeta, size: new Blob([source]).size }, saved: savedRef.current,
      sourceView, readingMode, readingPreferences, readingWidth, searchOpen, searchDraft, searchQuery, searchIndex, searchOptions, searchOptionsDraft, activeOutline, railMode, collapsedHeadings });
  }

  function historyLocation() {
    return { id: activeDocumentRef.current.key, position: getReadingPosition() };
  }

  function rememberNavigation() {
    if (navigatingHistoryRef.current || !tabsRef.current.length) return;
    const current = historyLocation(), previous = navigationHistoryRef.current.back.at(-1);
    if (previous?.id === current.id && Math.abs(Number(previous.position?.top ?? previous.position) - Number(current.position?.top ?? current.position)) < 3) return;
    navigationHistoryRef.current.back.push(current);
    navigationHistoryRef.current.back = navigationHistoryRef.current.back.slice(-100);
    navigationHistoryRef.current.forward = [];
    setNavigationVersion((value) => value + 1);
  }

  async function navigateHistory(direction) {
    const history = navigationHistoryRef.current, from = history[direction], to = direction === 'back' ? history.forward : history.back;
    const destination = from.pop();
    if (!destination) return { ok: false, error: 'history-empty' };
    to.push(historyLocation());
    navigatingHistoryRef.current = true;
    try {
      if (destination.id !== activeDocumentRef.current.key) await switchTab(destination.id);
      restoringPositionRef.current = false;
      await window.mengxReader.restoreReadingPosition(destination.position);
      return { ok: true };
    } finally { navigatingHistoryRef.current = false; setNavigationVersion((value) => value + 1); }
  }

  async function switchTab(id) {
    const tab = tabsRef.current.find((item) => item.id === id);
    if (!tab) throw new RangeError('Tab not found');
    if (activeDocumentRef.current.key === id) return { ok: true, name: tab.name, revision: documentRevisionRef.current };
    const session = tabSessionsRef.current.get(id);
    if (session) return awaitOpen(openTextDocument({ name: tab.name, path: tab.path, content: session.source, kind: tab.kind }));
    const result = await openRecentFile({ ...tab, type: tab.kind });
    return result?.ok === false ? result : awaitOpen(result);
  }

  async function closeTab(id = activeDocumentRef.current.key, { discard = false } = {}) {
    const tab = tabsRef.current.find((item) => item.id === id);
    if (!tab) throw new RangeError('Tab not found');
    const active = activeDocumentRef.current.key === id;
    if (active) checkpointTab();
    await writerRef.current.jobs.get(id);
    if (dirtyDocumentsRef.current.has(id) && !discard) {
      setCloseTabConfirmation(tab);
      return { ok: false, pending: true, error: 'unsaved-changes', id };
    }
    const index = tabsRef.current.indexOf(tab);
    closedTabsRef.current.unshift({ tab, session: tabSessionsRef.current.get(id), history: editHistoriesRef.current.get(id) });
    // Closed tabs retain a bounded number of snapshots, including drafts for recovery.
    while (closedTabsRef.current.length > 5 || closedTabsRef.current.reduce((n, item) => n + (item.session?.source.length || 0) * 2, 0) > 32 * 1024 * 1024) closedTabsRef.current.pop();
    if (discard) { dirtyDocumentsRef.current.delete(id); writerRef.current.states.delete(id); }
    tabSessionsRef.current.delete(id);
    editHistoriesRef.current.delete(id);
    const remaining = tabsRef.current.filter((item) => item.id !== id);
    updateTabs(remaining);
    setCloseTabConfirmation(null);
    if (active && remaining.length) await switchTab(remaining[Math.min(index, remaining.length - 1)].id);
    else if (active) {
      activeDocumentRef.current = { key: '', name: '', path: '', kind: 'MD' };
      sourceBaseRef.current = ''; draftHtmlRef.current = null; chunkDraftsRef.current.clear();
      setMarkdown(''); setFileName(''); setFileMeta({ source: '', kind: 'MD', size: 0 });
      setDirtyMarkers(true); setSaveState({ status: 'idle' }); closeSearch(); persistTabs();
    }
    return { ok: true, id };
  }

  async function reopenClosedTab() {
    const closed = closedTabsRef.current.shift();
    if (!closed) return { ok: false, error: 'no-closed-tab' };
    if (closed.session) tabSessionsRef.current.set(closed.tab.id, closed.session);
    if (closed.history) editHistoriesRef.current.set(closed.tab.id, closed.history);
    updateTabs([...tabsRef.current, closed.tab]);
    return switchTab(closed.tab.id);
  }

  function getDocumentSource() {
    if (editorDraftRef.current !== null) return editorDraftRef.current;
    if (draftHtmlRef.current !== null) return htmlToMarkdown(draftHtmlRef.current);
    if (!chunkDraftsRef.current.size) return sourceBaseRef.current;
    let source = sourceBaseRef.current;
    const edits = [...chunkDraftsRef.current.values()].sort((a, b) => b.start - a.start);
    for (const edit of edits) source = source.slice(0, edit.start) + (edit.source ?? htmlToMarkdown(edit.html) + '\n\n') + source.slice(edit.end);
    return source;
  }

  function openTextDocument({ name = 'untitled.md', path = '本地文件', content = '', kind, size, saved = true, fresh = false } = {}) {
    openRequestRef.current += 1;
    const normalizedKind = kind || (/\.txt$/i.test(name) ? 'TXT' : /\.docx$/i.test(name) ? 'DOCX' : /\.html?$/i.test(name) ? 'HTML' : 'MD');
    const displayPath = path || '本地文件';
    const key = documentCacheKey(name, displayPath);
    const existing = tabsRef.current.find((tab) => tab.id === key);
    // A recent-file reopen may explicitly request the current bytes from disk even
    // when that document is already the active tab. Keep the fast path for normal
    // tab switches, but let fresh reads replace the active snapshot.
    if (existing && activeDocumentRef.current.key === key && !fresh) return { name, path: displayPath, kind: normalizedKind, revision: documentRevisionRef.current };
    if (activeDocumentRef.current.key !== key) rememberNavigation();
    checkpointTab();
    const session = fresh ? null : tabSessionsRef.current.get(key);
    let readingState = {};
    try { readingState = JSON.parse(localStorage.getItem('mengx-reading-state-v1') || '{}')[key] || {}; } catch { /* defaults */ }
    const text = session?.source ?? String(content ?? '');
    const byteSize = session?.meta.size ?? size ?? new Blob([text]).size;
    saved = session?.saved ?? saved;
    restoringPositionRef.current = loadReadingPositions()[key] !== undefined;
    lastReadPositionRef.current = loadReadingPositions()[key] ?? null;
    setCollapsedHeadings(session?.collapsedHeadings ?? new Set(readingState.collapsed || []));
    const previous = fileContentsRef.current.get(key);
    if (!session && previous !== undefined && previous !== text && !dirtyDocumentsRef.current.has(key)) editHistoriesRef.current.delete(key);
    fileContentsRef.current.set(key, text);
    activeDocumentRef.current = { key, name, path: displayPath, kind: normalizedKind };
    void markStore.load(key, { name, handle: fileHandlesRef.current.get(key) });
    setMarkPopover(null);
    editorDraftRef.current = null;
    sourceBaseRef.current = text;
    documentRevisionRef.current += 1;
    performanceRef.current.currentOpen = { name, startedAt: performance.now() };
    setMarkdown(text);
    draftHtmlRef.current = session?.html ?? null;
    chunkDraftsRef.current = new Map(session?.chunks);
    lastEditSnapshotRef.current = session?.snapshot ?? { markdown: text, html: null, chunks: new Map(), selection: null };
    beforeInputRef.current = null;
    setFileName(name);
    setLocationDraft(isNativePath(displayPath) ? displayPath : `${displayPath.replace(/\/$/, '')}/${name}`);
    setFileMeta(session?.meta ?? { size: byteSize, source: displayPath, updated: 'just-now', kind: normalizedKind });
    setDirtyMarkers(saved);
    const status = writerRef.current.states.get(key);
    setSaveState(saved ? (fileHandlesRef.current.has(key) && ['MD', 'TXT'].includes(normalizedKind) ? { status: 'saved' } : { status: 'idle' }) : status || { status: 'session' });
    setHistoryVersion((value) => value + 1);
    setOpenGeneration((value) => value + 1);
    setReadingMode(session?.readingMode ?? true);
    setSourceView(session?.sourceView ?? readingState.sourceView ?? false);
    sourceTransitionRef.current = null;
    readingPositionCacheRef.current = null;
    setReadingWidth(session?.readingWidth ?? readReadingWidth(key));
    setReadingPreferences(session?.readingPreferences ?? readReadingPreferences(key));
    setHeadingTarget(null);
    setActiveOutline(session?.activeOutline ?? '');
    setOutlineFocus(''); setConflictDialog(false);
    setSearchOpen(session?.searchOpen ?? readingState.searchOpen ?? false);
    setSearchDraft(session?.searchDraft ?? readingState.searchQuery ?? '');
    setSearchQuery(session?.searchQuery ?? readingState.searchQuery ?? '');
    setSearchIndex(session?.searchIndex ?? readingState.searchIndex ?? 0);
    setSearchOptions(session?.searchOptions ?? normalizeSearchOptions(readingState.searchOptions));
    setSearchOptionsDraft(session?.searchOptionsDraft ?? normalizeSearchOptions(readingState.searchOptions));
    setWorkspaceSearch(null); setSearchError('');
    const restoredRail = session?.railMode ?? readingState.railMode ?? 'redlines';
    setRailMode(['redlines', 'marks'].includes(restoredRail) ? restoredRail : 'redlines');
    setAnnotationQuery('');
    setActiveAnnotation(null); setSelectionTools(null); selectedPassageRef.current = null;
    if (!saved) dirtyDocumentsRef.current.set(key, getDocumentSource());
    if (!existing) updateTabs([...tabsRef.current, { id: key, name, path: displayPath, kind: normalizedKind }]);
    persistTabs();
    if (readingScrollRef.current) readingScrollRef.current.scrollTop = 0;
    setRecentFiles((current) => [
      { name, path: displayPath, type: normalizedKind, time: 'just-now', active: true, size: byteSize },
      ...current.filter((item) => item.name !== name || item.path !== displayPath).map((item) => ({ ...item, active: false })),
    ].slice(0, 8));
    setNotice(`${name} ${copy.opened}`);
    setRecoveryAvailable(false); setPendingReview(null);
    void getRecovery(key).then((record) => {
      if (activeDocumentRef.current.key !== key) return;
      setRecoveryAvailable(Boolean(record.draft && record.draft.source !== text));
      if (record.review && (record.review.base === text || record.review.diskBaseline === text)) setPendingReview({ key, ...record.review });
    }).catch(() => {});
    return { name, path: displayPath, kind: normalizedKind, size: byteSize, revision: documentRevisionRef.current };
  }

  async function mapDirectoryAssets(assets) {
    clearAssetUrls();
    await Promise.all(assets.map(async ({ path, handle }) => {
      try {
        const file = await handle.getFile();
        const url = URL.createObjectURL(file);
        assetUrlsRef.current.push(url);
        assetMapRef.current.set(normalizeResourceKey(path), url);
        assetMapRef.current.set(normalizeResourceKey(file.name), url);
      } catch { /* unavailable assets do not block the document */ }
    }));
    setAssetVersion((value) => value + 1);
  }

  const activeSearchQuery = searchDraft.trim() === searchQuery.trim() && searchOptions.scope === 'document' && !searchError ? searchQuery : '';
  const documentAnalysis = useDocumentPreparation(markdown, activeSearchQuery, searchOptions);
  const outline = documentAnalysis.outline;
  const headingsBySlug = useMemo(() => new Map(outline.map((item) => [item.slug, item])), [outline]);
  const visibleOutline = useMemo(() => outline.filter((item) => {
    if (!collapsedHeadings.size) return true;
    let parent = item.parent;
    while (parent !== null && parent !== undefined) { if (collapsedHeadings.has(outline[parent].slug)) return false; parent = outline[parent].parent; }
    return true;
  }), [outline, collapsedHeadings]);
  const isLargeDocument = documentAnalysis.large;
  const usingRichEditor = !readingMode && !sourceView && ['MD', 'HTML', 'DOCX'].includes(fileMeta.kind || 'MD');
  const documentTitle = documentAnalysis.title || lightDocumentTitle(markdown, fileName);
  // Ragged-right for English, justified for Chinese (see textAlignFor); inherited by every view of the document.
  const documentAlign = useMemo(() => textAlignFor(markdown), [markdown]);
  const referenceAlign = useMemo(() => textAlignFor(referenceMarkdown), [referenceMarkdown]);
  const renderChunk = useCallback((source, query = '', searchOffset = 0, headingOffset = 0, chunk) =>
    safeMarkdown(source, query, (path) => resolveDocumentAsset(path), -1, searchOffset, headingOffset, searchOptions,
      { chunk, definitions: documentAnalysis.referenceDefinitions, results: documentAnalysis.results }), [assetVersion, currentDocumentKey, searchOptions, documentAnalysis.results, documentAnalysis.referenceDefinitions]);
  const renderReferenceChunk = useCallback((source, query = '', searchOffset = 0, headingOffset = 0, chunk) =>
    safeMarkdown(source, query, (path) => resolveDocumentAsset(path, referenceMeta?.handle), -1, searchOffset, headingOffset, undefined, chunk?.table ? { tablePart: chunk.table } : null), [assetVersion, referenceMeta]);
  const referenceAnalysis = useDocumentPreparation(splitView ? referenceMarkdown : '');
  const renderedReference = useMemo(() => splitView && !referenceAnalysis.large ? renderReferenceChunk(referenceMarkdown) : '', [splitView, referenceAnalysis.large, referenceMarkdown, renderReferenceChunk]);
  const renderedDocument = useMemo(() => {
    if (isLargeDocument) return { html: '', results: [], count: 0 };
    const html = safeMarkdown(markdown, activeSearchQuery, (source) => resolveDocumentAsset(source), -1, 0, 0, searchOptions, { results: documentAnalysis.results });
    const results = documentAnalysis.results;
    return { html, results, count: results.length };
  }, [markdown, isLargeDocument, activeSearchQuery, assetVersion, currentDocumentKey, searchOptions, documentAnalysis.results]);
  const renderedMarkdown = renderedDocument.html;
  // In the rich editor the visible text is searched directly (see editor-search.js).
  const editorSearchActive = usingRichEditor && searchOpen && searchOptions.scope === 'document' && Boolean(activeSearchQuery.trim());
  const searchResults = searchOptions.scope !== 'document' ? (workspaceSearch?.matches || []) : editorSearchActive ? editorMatches : isLargeDocument ? documentAnalysis.results : renderedDocument.results;
  const searchCount = searchResults.length;
  const searchableFiles = useMemo(() => {
    const seen = new Set();
    return [...workspaceFiles, ...recentFiles].filter((file) => {
      const key = normalizeResourceKey(file.path || file.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [workspaceFiles, recentFiles]);
  const filteredRecents = useMemo(() => {
    if (!quickQuery.trim()) return recentFiles;
    const query = quickQuery.toLowerCase();
    return recentFiles.filter((file) => `${file.name} ${file.path}`.toLowerCase().includes(query));
  }, [quickQuery, recentFiles]);
  const workspaceTree = useMemo(() => {
    if (directoryHandleRef.current?.desktop) {
      const rows = [];
      const visit = (parent, depth) => {
        for (const entry of desktopFolders.get(parent) || []) {
          if (entry.kind === 'folder') {
            rows.push({ ...entry, depth });
            if (expandedWorkspaceFolders.has(entry.path)) visit(entry.path, depth + 1);
          } else if (!quickQuery.trim() || entry.file.path.toLowerCase().includes(quickQuery.toLowerCase())) rows.push({ ...entry, depth });
        }
      };
      visit('', 0);
      return rows;
    }
    const files = [...workspaceFiles]
      .filter((file) => !quickQuery.trim() || `${file.name} ${file.path}`.toLowerCase().includes(quickQuery.toLowerCase()))
      .sort((a, b) => a.path.localeCompare(b.path));
    const rows = [];
    const emittedFolders = new Set();
    files.forEach((file) => {
      const parts = file.path.split('/').filter(Boolean);
      let visible = true;
      for (let index = 0; index < parts.length - 1; index += 1) {
        const folderPath = parts.slice(0, index + 1).join('/');
        if (!emittedFolders.has(folderPath)) {
          emittedFolders.add(folderPath);
          rows.push({ kind: 'folder', name: parts[index], path: folderPath, depth: index });
        }
        if (!expandedWorkspaceFolders.has(folderPath)) {
          visible = false;
          break;
        }
      }
      if (visible) rows.push({ kind: 'file', file, depth: Math.max(0, parts.length - 1) });
    });
    return rows;
  }, [workspaceFiles, quickQuery, expandedWorkspaceFolders, desktopFolders]);

  useEffect(() => {
    const stored = window.localStorage.getItem('morrow-recents');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) setRecentFiles(parsed.map((item, index) => ({ ...item, active: index === 0 })));
      } catch { /* keep starter data */ }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem('morrow-recents', JSON.stringify(recentFiles.map(({ name, path, type, time, active, size }) => ({ name, path, type, time, active, size }))));
  }, [recentFiles]);

  useEffect(() => {
    window.localStorage.setItem('morrow-language', language);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  useEffect(() => {
    window.localStorage.setItem('morrow-reading-width', readingWidth);
  }, [readingWidth]);

  useEffect(() => {
    if (preferenceDocumentRef.current !== currentDocumentKey) {
      preferenceDocumentRef.current = currentDocumentKey;
      return;
    }
    const value = normalizeReadingPreferences(readingPreferences);
    window.localStorage.setItem('mengx-reading-preferences', JSON.stringify(value));
    try {
      const stored = JSON.parse(window.localStorage.getItem('mengx-reading-preferences-by-document') || '{}');
      stored[currentDocumentKey] = { ...stored[currentDocumentKey], ...value, readingWidth };
      window.localStorage.setItem('mengx-reading-preferences-by-document', JSON.stringify(stored));
    } catch { /* preference persistence should never block reading */ }
  }, [readingPreferences, readingWidth, currentDocumentKey]);

  useEffect(() => {
    window.localStorage.setItem('mengx-focus-reading', String(focusMode));
  }, [focusMode]);

  function changeFocusMode(value) {
    const next = Boolean(value);
    if (next && !focusMode) { focusOutlineRef.current = outlineOpen; setOutlineOpen(false); }
    if (!next && focusMode && focusOutlineRef.current !== null) { setOutlineOpen(focusOutlineRef.current); focusOutlineRef.current = null; }
    setFocusMode(next);
    return next;
  }

  async function changeSourceView(value) {
    const next = Boolean(value);
    if (next === sourceView) return { ok: true, sourceView: next };
    const position = getReadingPosition();
    const offset = position.sourceOffset ?? position.anchor?.sourceOffset ?? position.sourceStart ?? headingsBySlug.get(activeOutline)?.offset ?? 0;
    const source = getDocumentSource();
    if (!position.anchor && source.length) {
      const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
      const quote = source.slice(lineStart, source.indexOf('\n', offset) < 0 ? source.length : source.indexOf('\n', offset))
        .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '').replace(/[*_`]/g, '').trim().slice(0, 100);
      try { position.anchor = createTextAnchor(source, { text: quote, sourceOffset: lineStart, regionStart: Math.max(0, lineStart - 1000), regionEnd: lineStart + 80000 }); } catch { /* chunk offset remains available */ }
    }
    commitInlineEdit({ lock: false, notify: false });
    readingPositionCacheRef.current = null;
    restoringPositionRef.current = false;
    const transition = { key: currentDocumentKey, next, offset, position };
    sourceTransitionRef.current = transition;
    setSourceView(next);
    await waitForReader(() => sourceTransitionRef.current !== transition);
    return { ok: true, sourceView: next, sourceOffset: offset };
  }

  useEffect(() => {
    const transition = sourceTransitionRef.current;
    if (!transition || transition.key !== currentDocumentKey || transition.next !== sourceView || !documentAnalysis.ready) return;
    let cancelled = false;
    void (async () => {
      if (sourceView) readingNavigationRef.current?.goToSource(transition.offset);
      else await restoreReadingPosition(transition.position);
      if (!cancelled && sourceTransitionRef.current === transition) sourceTransitionRef.current = null;
    })();
    return () => { cancelled = true; };
  }, [sourceView, currentDocumentKey, documentAnalysis.ready, markdown]);

  useEffect(() => {
    let cancelled = false;
    startupRef.current = (async () => {
      try {
        const stored = JSON.parse(localStorage.getItem('mengx-tabs-v1') || 'null');
        if (!window.mengxDesktop || !stored?.tabs?.length) return;
        const records = stored.tabs.filter((tab) => typeof tab.path === 'string' && isNativePath(tab.path));
        const active = records.find((tab) => tab.id === stored.activeId) || records.at(-1);
        if (!active) return;
        const handle = await restoreFileHandle(active.id);
        if (!handle || cancelled || openRequestRef.current) return;
        const file = await handle.getFile();
        if (cancelled || openRequestRef.current) return;
        updateTabs(records);
        await openFileObject(file, handle, active.path, active.path);
      } catch { /* A missing previous file never prevents a new document from opening. */ }
      finally { if (!cancelled) setRestoringSession(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Charts and Mermaid diagrams in rendered Markdown (reading view, split view, review).
  useEffect(() => {
    const area = document.querySelector('.main-area');
    if (!area) return undefined;
    const labels = language === 'zh'
      ? { data: '数据', source: '源码', mark: '对图表下指令', markHint: '选中整个图表的数据，给 AI 下指令', failed: '图表无法渲染' }
      : { data: 'Data', source: 'Source', mark: 'Instruct on chart', markHint: 'Select the whole chart data to give the AI an instruction', failed: 'Diagram could not be rendered' };
    const renderMermaid = (source, options) => import('./mermaid-renderer').then(({ renderMermaidSvg }) => renderMermaidSvg(source, { ...options, waitForScroll: true }));
    const tableLabels = language === 'zh'
      ? { sum: '合计', average: '平均', insert: '插入为合计行', insertHint: '把合计写进文档，作为表格最后一行', sortHint: '点击排序（只改变显示顺序，不改文档）' }
      : { sum: 'Total', average: 'Average', insert: 'Insert as total row', insertHint: 'Write the totals into the document as the last table row', sortHint: 'Click to sort (display only; the document is unchanged)' };
    let frame = 0;
    const run = () => {
      frame = 0;
      area.querySelectorAll('.document-content').forEach((root) => {
        if (root.closest('.markdown-editor')) return;
        hydrateWidgets(root, { renderMermaid, labels });
        if (root.closest('.reading-column, .reference-column')) enhanceTables(root, tableLabels);
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(run); };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(area, { childList: true, subtree: true });
    // "Instruct on chart": select the chart's data (or diagram source) and open the mark tools.
    const selectComponent = (event) => {
      const node = event.detail?.node; if (!node) return;
      const range = document.createRange(); range.selectNodeContents(node);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      requestAnimationFrame(() => document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
    };
    area.addEventListener('stetwise:select-component', selectComponent);
    const onTableClick = (event) => {
      const insert = event.target.closest?.('.pl-insert-total');
      if (insert) { event.preventDefault(); event.stopPropagation(); tableActionsRef.current?.insertTotal(insert.closest('table')); return; }
      const header = event.target.closest?.('th[data-pl-sort]');
      if (header && !window.getSelection()?.toString() && header.closest('.reading-column, .reference-column')) sortTable(header.closest('table'), Number(header.dataset.plColumn));
    };
    area.addEventListener('click', onTableClick, true);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); area.removeEventListener('stetwise:select-component', selectComponent); area.removeEventListener('click', onTableClick, true); };
  }, [language]);

  useEffect(() => {
    const changed = () => {
      if (sourceView) { setSelectionTools(null); return; }
      const anchorNode = window.getSelection()?.anchorNode;
      if (anchorNode && (anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentElement)?.closest?.('table[data-sorted]')) {
        selectedPassageRef.current = null; setSelectionTools(null);
        setNotice(language === 'zh' ? '表格已按列排序，只是显示顺序变了。要标记表格里的内容，请先点表头恢复原顺序。' : 'This table is sorted for display. Click the header to restore the original order before marking it.');
        return;
      }
      const captured = captureReadingSelection(articleRef.current, getDocumentSource(), documentAnalysis.chunks);
      selectedPassageRef.current = captured?.anchor || null;
      setSelectionTools(captured ? { left: Math.max(8, Math.min(window.innerWidth - 240, captured.rect.left)), top: Math.max(62, Math.min(window.innerHeight - 48, captured.rect.bottom + 8)) } : null);
    };
    // Avoid changing selection/caret while the user is dragging or composing text.
    const onPointer = (event) => { if (event.target.closest?.('.selection-tools, .selection-context-menu, .note-dialog')) return; changed(); };
    const onKey = (event) => { if (event.shiftKey || event.key.startsWith('Arrow')) changed(); };
    const onContextMenu = (event) => {
      if (sourceView || !articleRef.current?.contains(event.target) || event.target.closest?.('.selection-tools, .selection-context-menu, .note-dialog')) return;
      const captured = captureReadingSelection(articleRef.current, getDocumentSource(), documentAnalysis.chunks);
      const selected = window.getSelection()?.toString() || '';
      if (!captured && !selected.trim()) return;
      event.preventDefault();
      // Still offer Copy when a selection cannot be tied to the source; marks need an anchor.
      const text = selected || captured.anchor.text;
      selectedPassageRef.current = captured?.anchor || null;
      setSelectionTools(null);
      setSelectionContextMenu({
        left: Math.max(8, Math.min(window.innerWidth - 268, event.clientX)),
        top: Math.max(8, Math.min(window.innerHeight - 260, event.clientY)),
        text,
        anchor: captured?.anchor || null,
      });
    };
    document.addEventListener('pointerup', onPointer); document.addEventListener('keyup', onKey); document.addEventListener('contextmenu', onContextMenu);
    return () => { document.removeEventListener('pointerup', onPointer); document.removeEventListener('keyup', onKey); document.removeEventListener('contextmenu', onContextMenu); };
  }, [currentDocumentKey, documentAnalysis.chunks, sourceView]);

  useEffect(() => {
    if (!selectionContextMenu) return undefined;
    const close = (event) => {
      if (!event.target.closest?.('.selection-context-menu')) setSelectionContextMenu(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [selectionContextMenu]);

  // The round whose changes are shown in the text: an outside change, or a review that was applied.
  const roundDiff = useMemo(() => {
    if (!round || round.undone || round.key !== currentDocumentKey || !['external', 'review'].includes(round.kind) || round.previous === round.next) return null;
    try { return { diff: diffBlocks(round.previous, round.next), next: round.next }; } catch { return null; }
  }, [round, currentDocumentKey]);
  useEffect(() => { if (!roundDiff) setChangePopover(null); }, [roundDiff]);

  useEffect(() => {
    const root = articleRef.current;
    if (!root || sourceView || usingRichEditor) { clearReadingHighlights(); paintedMarksRef.current = []; return; }
    let timer;
    let frame = 0;
    let secondFrame = 0;
    const region = readingScrollRef.current;
    const paint = () => {
      paintedMarksRef.current = paintReadingHighlights(root, markStore.get(currentDocumentKey), getDocumentSource(), documentAnalysis.chunks, markPopover?.id || activeAnnotation);
      // The last round of changes stays visible in the text until its bar is dismissed or the text moves on.
      if (roundDiff && getDocumentSource() === roundDiff.next) { try { roundChangesRef.current = paintRoundChanges(root, roundDiff.diff, documentAnalysis.chunks, plainText, diffArrays); } catch { roundChangesRef.current = []; clearRoundChanges(); } }
      else { roundChangesRef.current = []; clearRoundChanges(); }
    };
    paint();
    // The reader may render markdown and editable chunks in separate commits.
    // Paint once immediately and again after both commits have settled.
    frame = requestAnimationFrame(() => {
      paint();
      secondFrame = requestAnimationFrame(paint);
    });
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(paint, 160); });
    const resize = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(paint, 100); });
    resize.observe(root); if (region) resize.observe(region);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); resize.disconnect(); clearTimeout(timer); cancelAnimationFrame(frame); cancelAnimationFrame(secondFrame); clearReadingHighlights(); clearRoundChanges(); };
  }, [currentDocumentKey, documentAnalysis.ready, documentAnalysis.chunks, annotationVersion, activeAnnotation, markPopover?.id, markdown, openGeneration, sourceView, readingMode, historyVersion, usingRichEditor, review, roundDiff]);

  useEffect(() => {
    if (usingRichEditor && !richPartRef.current) startRichPart();
  }, [usingRichEditor, richPart, currentDocumentKey]);

  // Any painted mark is clickable and shows a pointer, so marks never get "stuck".
  useEffect(() => {
    const root = articleRef.current;
    if (!root || usingRichEditor) return undefined;
    let frame = 0;
    const move = (event) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const over = !window.getSelection()?.toString() && ((paintedMarksRef.current.length && hitTestMarks(paintedMarksRef.current, event.clientX, event.clientY)) || (roundChangesRef.current.length && hitTestMarks(roundChangesRef.current, event.clientX, event.clientY)));
        root.classList.toggle('over-mark', Boolean(over));
      });
    };
    root.addEventListener('mousemove', move);
    return () => { cancelAnimationFrame(frame); root.removeEventListener('mousemove', move); root.classList.remove('over-mark'); };
  }, [currentDocumentKey, openGeneration, sourceView, usingRichEditor, documentAnalysis.ready]);

  function loadReadingPositions() {
    if (!scrollPositionsRef.current) {
      try {
        scrollPositionsRef.current = JSON.parse(window.localStorage.getItem('morrow-scroll-positions') || '{}');
      } catch {
        scrollPositionsRef.current = {};
      }
    }
    return scrollPositionsRef.current;
  }

  function rememberReadingPosition() {
    if (restoringPositionRef.current) return;
    const positions = loadReadingPositions();
    positions[activeDocumentRef.current.key] = getReadingPosition();
    window.localStorage.setItem('morrow-scroll-positions', JSON.stringify(positions));
  }

  function getReadingPosition() {
    const region = readingScrollRef.current;
    const cacheKey = `${currentDocumentKey}:${sourceView}:${documentRevisionRef.current}:${region?.scrollTop}:${region?.clientWidth}:${region?.scrollHeight}:${activeOutline}`;
    if (readingPositionCacheRef.current?.key === cacheKey) return readingPositionCacheRef.current.position;
    const position = readingNavigationRef.current?.getPosition() ?? { top: region?.scrollTop || 0 };
    const result = typeof position === 'object' ? { ...position } : { top: position };
    if (sourceView) {
      const source = getDocumentSource(), offset = result.sourceOffset ?? result.sourceStart ?? 0;
      const start = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
      const end = source.indexOf('\n', offset);
      const text = source.slice(start, end < 0 ? source.length : end)
        .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '').replace(/[*_`]/g, '').trim().slice(0, 100);
      try { result.anchor = createTextAnchor(source, { text, sourceOffset: offset, regionStart: start, regionEnd: Math.min(source.length, start + 80000) }); } catch { /* the source offset remains usable */ }
      result.passageOffset = 12;
      result.heading = activeOutline;
      readingPositionCacheRef.current = { key: cacheKey, position: result };
      return result;
    }
    const top = region?.getBoundingClientRect().top || 0;
    const passage = [...(articleRef.current?.querySelectorAll('p, li, pre, h2, h3, h4, h5, h6') || [])]
      .find((node) => node.getBoundingClientRect().bottom > top + 16);
    if (passage) {
      const text = passage.textContent.trim().slice(0, 100);
      const start = Number(passage.closest('[data-edit-region]')?.dataset.editRegion) || 0;
      try { result.anchor = createTextAnchor(sourceBaseRef.current, { text, sourceOffset: start, regionStart: start, regionEnd: start + (isLargeDocument ? 80000 : sourceBaseRef.current.length) }); } catch { /* scroll offset remains usable */ }
      result.passageOffset = passageTextTop(passage) - top;
    }
    result.heading = activeOutline;
    readingPositionCacheRef.current = { key: cacheKey, position: result };
    return result;
  }

  /**
   * Top of a passage's first line of text. A saved position is found again by its text
   * (findRenderedAnchor), so it is measured on the text too: a block's padding, or a note
   * generated above it, would otherwise move the page a little on every return.
   */
  function passageTextTop(passage) {
    const walker = document.createTreeWalker(passage, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.nodeValue.search(/\S/);
      if (at < 0) continue;
      const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 1);
      const box = range.getBoundingClientRect();
      if (box.height) return box.top;
    }
    return passage.getBoundingClientRect().top;
  }

  function getReferencePosition() {
    const region = referenceScrollRef.current;
    const key = `${referenceMeta?.path}:${referenceName}:${region?.scrollTop}:${region?.clientWidth}:${region?.scrollHeight}`;
    if (referencePositionCacheRef.current?.key === key) return referencePositionCacheRef.current.position;
    const position = referenceNavigationRef.current?.getPosition() ?? { top: region?.scrollTop || 0 };
    const result = typeof position === 'object' ? { ...position } : { top: position };
    const top = region?.getBoundingClientRect().top || 0;
    const passage = [...(referenceArticleRef.current?.querySelectorAll('p, li, pre, h1, h2, h3, h4, h5, h6') || [])]
      .find((node) => node.getBoundingClientRect().bottom > top + 16);
    if (passage) {
      const start = Number(passage.closest('[data-edit-region]')?.dataset.editRegion) || 0;
      try { result.anchor = createTextAnchor(referenceMarkdown, { text: passage.textContent.trim().slice(0, 100), sourceOffset: start,
        regionStart: start, regionEnd: referenceAnalysis.large ? start + 80000 : referenceMarkdown.length }); } catch { /* Pixel and chunk positions remain usable. */ }
      result.passageOffset = passageTextTop(passage) - top;
    }
    referencePositionCacheRef.current = { key, position: result };
    return result;
  }

  function rememberReferencePosition() {
    if (!splitView || !referenceMeta || referenceRestoreRef.current) return;
    const key = documentCacheKey(referenceName, referenceMeta.path);
    const positions = loadReadingPositions();
    positions[key] = getReferencePosition();
    localStorage.setItem('morrow-scroll-positions', JSON.stringify(positions));
  }

  function closeSplit() { rememberReferencePosition(); setSplitView(false); }

  async function openReference(input) {
    rememberReferencePosition();
    let result;
    if (input instanceof File || input?.file instanceof File) {
      const file = input.file || input;
      result = { name: file.name, ...(await normalizeImportedFile(file)), size: file.size };
    } else result = { name: input.name || 'reference.md', content: String(input.content ?? ''), kind: input.kind || 'MD' };
    const path = input?.path || input?.handle?.path || result.name;
    referenceRestoreRef.current = loadReadingPositions()[documentCacheKey(result.name, path)] ?? { top: 0 };
    setReferenceName(result.name); setReferenceMarkdown(result.content);
    setReferenceMeta({ kind: result.kind, size: result.size, handle: input?.handle, path });
    setSplitView(true);
    await waitForReader((api) => api.getState().reference?.name === result.name && api.getState().reference.ready);
    return { ok: true, name: result.name };
  }

  async function swapSplit() {
    if (!splitView) return { ok: false, error: 'split-closed' };
    rememberReferencePosition();
    const left = { name: fileName, content: getDocumentSource(), kind: fileMeta.kind, path: fileMeta.source, handle: fileHandlesRef.current.get(currentDocumentKey) };
    const right = { name: referenceName, path: referenceMeta?.path, content: referenceMarkdown, kind: referenceMeta?.kind };
    if (referenceMeta?.handle) fileHandlesRef.current.set(documentCacheKey(right.name, right.path), referenceMeta.handle);
    const opened = openTextDocument(right);
    await openReference(left);
    return awaitOpen(opened);
  }

  function handleReferenceClick(event) {
    const image = event.target.closest('img');
    if (image) setLightbox({ src: image.currentSrc || image.src, alt: image.alt, source: image.dataset.source, handle: referenceMeta?.handle, key: `${referenceMeta?.path}:${image.dataset.source || image.src}` });
    const link = event.target.closest('a[href]');
    if (link?.getAttribute('href')?.startsWith('#')) {
      event.preventDefault(); const hash = decodeURIComponent(link.getAttribute('href').slice(1));
      const item = referenceAnalysis.outline.find((item) => item.slug === hash || item.slug.replace(/-\d+$/, '') === hash);
      if (item && referenceNavigationRef.current) referenceNavigationRef.current.goToSource(item.offset);
      else referenceArticleRef.current?.querySelector(`[data-heading="${CSS.escape(item?.slug || hash)}"], [id="${CSS.escape(hash)}"]`)?.scrollIntoView({ block: 'start' });
    } else if (link) { event.preventDefault(); void openDocumentLink(link.getAttribute('href'), true); }
  }

  async function openDocumentLink(href, reference = false) {
    try {
      if (/^(https?:|mailto:)/i.test(href)) {
        if (window.mengxDesktop) await window.mengxDesktop.openExternal(href);
        else window.open(href, '_blank', 'noopener,noreferrer');
        return { ok: true, external: true };
      }
      if (/^[a-z][a-z\d+.-]*:/i.test(href) || /^[/\\]/.test(href)) throw new Error(language === 'zh' ? '仅支持网页链接、文档锚点和相对文档路径' : 'Use a web link, document anchor or relative document path');
      const [source, hash = ''] = href.split('#');
      const handle = reference ? referenceMeta?.handle : fileHandlesRef.current.get(currentDocumentKey);
      if (!handle?.desktop) {
        const base = (reference ? referenceMeta?.path : fileMeta.source)?.replace(/[^/\\]+$/, '') || '';
        const target = workspaceFiles.find((item) => normalizeResourceKey(item.path) === normalizeResourceKey(base + decodeURIComponent(source)));
        if (!target) throw new Error(language === 'zh' ? '关联文档尚未打开，请用桌面版打开或选择所在文件夹' : 'Open the containing folder or use the desktop reader');
        if (reference) {
          const linked = fileHandlesRef.current.get(documentCacheKey(target.name, target.path));
          const file = target.file || (linked && await linked.getFile());
          if (file) await openReference({ file, handle: linked, path: target.path });
          else await openReference({ name: target.name, content: fileContentsRef.current.get(documentCacheKey(target.name, target.path)) || '', path: target.path, kind: target.type });
        } else await openRecentFile(target);
      } else {
        const linked = desktopHandle(await window.mengxDesktop.openLinkedFile(handle.id, source));
        if (reference) await openReference({ file: await linked.getFile(), handle: linked, path: linked.path });
        else await openFileObject(await linked.getFile(), linked, copy.localFile, linked.path);
      }
      await waitForReader((api) => reference ? api.getState().reference?.ready : api.getState().document.ready);
      if (hash) {
        const slug = decodeURIComponent(hash);
        if (reference) await window.mengxReader.goToReferenceHeading(slug);
        else await window.mengxReader.goToHeading(slug);
      }
      return { ok: true };
    } catch (error) { setNotice(error.message); return { ok: false, error: error.message }; }
  }

  function handleResourceError(event) {
    const image = event.target;
    if (image.tagName !== 'IMG' || !image.closest('.document-content')) return;
    if (image.nextElementSibling?.classList.contains('resource-error')) return;
    const message = document.createElement('span');
    message.className = 'resource-error'; message.dataset.readerUi = 'true'; message.contentEditable = 'false';
    message.textContent = `${language === 'zh' ? '图片无法读取：' : 'Image unavailable: '}${image.dataset.source || image.getAttribute('src') || image.alt}`;
    image.after(message);
  }

  function handleResourceLoad(event) {
    const image = event.target;
    if (image.tagName === 'IMG' && image.nextElementSibling?.classList.contains('resource-error')) image.nextElementSibling.remove();
  }

  useEffect(() => {
    if (!splitView || !referenceAnalysis.ready) return;
    const right = referenceScrollRef.current, left = readingScrollRef.current;
    if (!right || !left) return;
    let frame, saveTimer, cancelled = false;
    frame = requestAnimationFrame(() => {
      const saved = referenceRestoreRef.current;
      if (saved) {
        if (referenceNavigationRef.current) referenceNavigationRef.current.restore(saved);
        else right.scrollTop = Number(saved.top ?? saved) || 0;
        if (saved.anchor) {
          const anchor = resolveTextAnchor(referenceMarkdown, saved.anchor);
          if (!anchor.orphaned) {
            referenceNavigationRef.current?.goToSource(anchor.sourceOffset);
            void waitForReader(() => {
              if (cancelled) return true;
              const range = findRenderedAnchor(referenceArticleRef.current, anchor, referenceAnalysis.chunks);
              if (!range) return false;
              referenceNavigationRef.current?.cancel();
              right.scrollTop += range.getBoundingClientRect().top - right.getBoundingClientRect().top - (saved.passageOffset || 0);
              return true;
            }, { timeoutMs: 4000 }).catch(() => {});
          }
        }
        referenceRestoreRef.current = null;
      }
    });
    const sync = (from, to) => {
      if (!splitSync || splitSyncingRef.current) return;
      splitSyncingRef.current = true;
      to.scrollTop = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight) * Math.max(0, to.scrollHeight - to.clientHeight);
      requestAnimationFrame(() => { splitSyncingRef.current = false; });
    };
    const onRight = () => { sync(right, left); clearTimeout(saveTimer); saveTimer = setTimeout(rememberReferencePosition, 180); };
    const onLeft = () => sync(left, right);
    right.addEventListener('scroll', onRight, { passive: true }); left.addEventListener('scroll', onLeft, { passive: true });
    return () => { cancelled = true; cancelAnimationFrame(frame); clearTimeout(saveTimer); right.removeEventListener('scroll', onRight); left.removeEventListener('scroll', onLeft); };
  }, [splitView, splitSync, referenceAnalysis.ready, referenceMarkdown, referenceMeta, currentDocumentKey]);

  function toggleHeading(slug) {
    setCollapsedHeadings((current) => { const next = new Set(current); if (next.has(slug)) next.delete(slug); else next.add(slug); return next; });
  }

  function outlineBreadcrumb(item) {
    const parts = [item.text]; let parent = item.parent;
    while (parent !== null && parent !== undefined) { parts.unshift(outline[parent].text); parent = outline[parent].parent; }
    return parts.join(' / ');
  }

  function handleOutlineKey(event, item) {
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      if (item.children) setCollapsedHeadings((current) => { const next = new Set(current); if (event.key === 'ArrowLeft') next.add(item.slug); else next.delete(item.slug); return next; });
    }
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const index = visibleOutline.indexOf(item);
      const next = visibleOutline[event.key === 'Home' ? 0 : event.key === 'End' ? visibleOutline.length - 1 : Math.max(0, Math.min(visibleOutline.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))];
      if (next) setOutlineFocus(next.slug);
    }
  }

  useEffect(() => {
    localStorage.setItem('mengx-sidebar-open', String(sidebarOpen));
    localStorage.setItem('mengx-outline-open', String(outlineOpen));
    localStorage.setItem('mengx-sidebar-width', String(sidebarWidth));
  }, [sidebarOpen, outlineOpen, sidebarWidth]);

  async function restoreReadingPosition(position = lastReadPositionRef.current) {
    if (position === null || position === undefined) return { ok: false, error: 'reading-position-unavailable' };
    rememberNavigation(); restoringPositionRef.current = false;
    if (sourceView && readingNavigationRef.current) {
      readingNavigationRef.current.goToSource(position.sourceOffset ?? position.anchor?.sourceOffset ?? position.sourceStart ?? 0);
      return { ok: true, revision: documentRevisionRef.current };
    }
    if (readingNavigationRef.current) readingNavigationRef.current.restore(position);
    else readingScrollRef.current?.scrollTo({ top: Number(position?.top ?? position) || 0, behavior: 'auto' });
    if (position.anchor) {
      const anchor = resolveTextAnchor(sourceBaseRef.current, position.anchor);
      if (!anchor.orphaned) {
        if (isLargeDocument) readingNavigationRef.current?.goToSource(anchor.sourceOffset);
        await waitForReader(() => {
          const range = findRenderedAnchor(articleRef.current, anchor, documentAnalysis.chunks);
          if (!range) return false;
          readingNavigationRef.current?.cancel();
          readingScrollRef.current.scrollTop += range.getBoundingClientRect().top - readingScrollRef.current.getBoundingClientRect().top - (position.passageOffset || 0);
          return true;
        }, { timeoutMs: 4000 }).catch(() => {});
      }
    }
    return { ok: true, revision: documentRevisionRef.current };
  }

  useEffect(() => {
    if (!currentDocumentKey || restoringSession) return;
    const timer = setTimeout(() => {
      try {
        const all = JSON.parse(localStorage.getItem('mengx-reading-state-v1') || '{}');
        all[currentDocumentKey] = { collapsed: [...collapsedHeadings], searchOpen, searchQuery, searchIndex, searchOptions, railMode, readingMode, sourceView };
        localStorage.setItem('mengx-reading-state-v1', JSON.stringify(all));
      } catch { /* optional state should not interrupt reading */ }
    }, 200);
    return () => clearTimeout(timer);
  }, [currentDocumentKey, restoringSession, collapsedHeadings, searchOpen, searchQuery, searchIndex, searchOptions, railMode, readingMode, sourceView]);

  useEffect(() => {
    const region = readingScrollRef.current;
    if (!region || !documentAnalysis.ready) return;
    let frame;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const viewport = region.getBoundingClientRect();
        let heading = outline[0];
        if (isLargeDocument || sourceView) {
          const position = readingNavigationRef.current?.getPosition();
          let low = 0, high = outline.length;
          while (low < high) { const middle = (low + high) >>> 1; if (outline[middle].offset <= (position?.sourceOffset ?? position?.sourceStart ?? 0)) low = middle + 1; else high = middle; }
          heading = outline[Math.max(0, low - 1)];
        }
        for (const node of articleRef.current?.querySelectorAll('[data-heading]') || []) {
          if (node.getBoundingClientRect().top <= viewport.top + 48) heading = headingsBySlug.get(node.dataset.heading) || heading;
        }
        setActiveOutline(heading?.slug || '');
        setReadingProgress(Math.round(region.scrollTop / Math.max(1, region.scrollHeight - region.clientHeight) * 100));
      });
    };
    update(); region.addEventListener('scroll', update, { passive: true });
    return () => { cancelAnimationFrame(frame); region.removeEventListener('scroll', update); };
  }, [currentDocumentKey, documentAnalysis.ready, outline, headingsBySlug, isLargeDocument, openGeneration, sourceView]);

  useEffect(() => {
    if (!documentAnalysis.ready) return;
    loadReadingPositions();
    const key = currentDocumentKey;
    const scrollTarget = readingScrollRef.current;
    if (!scrollTarget) return;
    const restore = window.requestAnimationFrame(() => {
      if (restoredGenerationRef.current === openGeneration) return;
      restoredGenerationRef.current = openGeneration;
      const position = scrollPositionsRef.current[key];
      if (position !== undefined && restoringPositionRef.current) void restoreReadingPosition(position);
    });
    let saveTimer = 0;
    const savePosition = () => {
      if (restoringPositionRef.current) return;
      if (saveTimer) return;
      saveTimer = window.setTimeout(() => {
        saveTimer = 0;
        if (restoringPositionRef.current || activeDocumentRef.current.key !== key) return;
        if (!scrollPositionsRef.current) scrollPositionsRef.current = {};
        scrollPositionsRef.current[key] = getReadingPosition();
        window.localStorage.setItem('morrow-scroll-positions', JSON.stringify(scrollPositionsRef.current));
      }, 180);
    };
    scrollTarget.addEventListener('scroll', savePosition, { passive: true });
    return () => {
      window.cancelAnimationFrame(restore);
      window.clearTimeout(saveTimer);
      scrollTarget.removeEventListener('scroll', savePosition);
    };
  }, [currentDocumentKey, documentAnalysis.ready, openGeneration, sourceView]);

  useEffect(() => {
    const region = readingScrollRef.current;
    if (!region) return;
    const userInteraction = () => { restoringPositionRef.current = false; };
    for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) region.addEventListener(event, userInteraction, { passive: true });
    return () => { for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) region.removeEventListener(event, userInteraction); };
  }, [currentDocumentKey, documentAnalysis.ready, openGeneration]);

  useEffect(() => {
    const flush = () => { void autoSaveHandlerRef.current?.(); };
    const hide = () => { if (document.visibilityState === 'hidden') flush(); };
    const leave = (event) => {
      if (window.mengxDesktop) return;
      if (!savedRef.current || writerRef.current.jobs.size || dirtyDocumentsRef.current.size) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('blur', flush);
    window.addEventListener('beforeunload', leave);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('blur', flush);
      window.removeEventListener('beforeunload', leave);
      window.clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!window.mengxDesktop) return;
    const offClose = window.mengxDesktop.onClose(async () => {
      rememberReadingPosition();
      try {
        await flushAutomaticSave();
        await markStore.flush();
        await Promise.all([...writerRef.current.jobs.values()]);
        window.mengxDesktop.finishClose({ unsaved: dirtyDocumentsRef.current.size > 0 || !savedRef.current });
      } catch { window.mengxDesktop.finishClose({ unsaved: true }); }
    });
    const offOpen = window.mengxDesktop.onOpen(async (record) => {
      const handle = desktopHandle(record);
      if (handle.kind === 'directory') await window.mengxReader.openDirectory(handle);
      else await window.mengxReader.openFile({ file: await handle.getFile(), handle, path: handle.path });
    });
    window.mengxDesktop.ready();
    return () => { offClose(); offOpen(); };
  }, []);

  useEffect(() => {
    if (!desktopWindow) return undefined;
    let active = true;
    void window.mengxDesktop.isMaximized().then((value) => { if (active) setWindowMaximized(Boolean(value)); }).catch(() => {});
    return () => { active = false; };
  }, [desktopWindow]);

  useEffect(() => {
    if (!recentMenu) return;
    const close = (event) => { if (!event.target.closest('.recent-menu, .recent-menu-trigger')) setRecentMenu(null); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [recentMenu]);

  useEffect(() => {
    if (!documentMenuOpen) return;
    const close = (event) => { if (!event.target.closest('.document-menu-anchor')) setDocumentMenuOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [documentMenuOpen]);

  useEffect(() => {
    setDocumentMenuOpen(false);
    setPathOpen(false);
  }, [currentDocumentKey]);

  useEffect(() => {
    if (!undoToast) return undefined;
    const timer = window.setTimeout(() => setUndoToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [undoToast]);

  useEffect(() => {
    if (!actionToast) return undefined;
    const timer = window.setTimeout(() => setActionToast(null), 9000);
    return () => window.clearTimeout(timer);
  }, [actionToast]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const current = performanceRef.current.currentOpen;
    if (!current || !documentAnalysis.ready || current.name !== fileName) return;
    performanceRef.current.opens.push({ name: current.name, durationMs: Math.round(performance.now() - current.startedAt), bytes: fileMeta.size || 0 });
    performanceRef.current.opens = performanceRef.current.opens.slice(-20);
    performanceRef.current.currentOpen = null;
  }, [documentAnalysis.ready, fileName, fileMeta.size]);

  useEffect(() => {
    // Search is restored per tab; submitting a query explicitly resets its index.
  }, [searchQuery]);

  useEffect(() => {
    if (!editorSearchActive) { clearEditorMatches(); setEditorMatches((current) => (current.length ? [] : current)); return undefined; }
    let timer = 0;
    const scan = () => {
      const root = document.querySelector('.markdown-editor .ProseMirror');
      setEditorMatches(root ? findEditorMatches(root, activeSearchQuery, searchOptions, language) : []);
    };
    scan();
    const host = document.querySelector('.markdown-editor');
    const observer = host ? new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 200); }) : null;
    observer?.observe(host, { subtree: true, childList: true, characterData: true });
    return () => { observer?.disconnect(); clearTimeout(timer); clearEditorMatches(); };
  }, [editorSearchActive, activeSearchQuery, searchOptions, language, editorKey, richPart?.index]);

  useEffect(() => { if (editorSearchActive) paintEditorMatches(editorMatches, searchIndex); }, [editorSearchActive, editorMatches, searchIndex]);
  const editorHasMatches = editorMatches.length > 0;
  useEffect(() => {
    if (!editorSearchActive || !editorHasMatches) return;
    revealRange(editorMatches[Math.min(searchIndex, editorMatches.length - 1)]?.range, readingScrollRef.current);
    // Only jump when the user moves to another match, not while the document is being edited.
  }, [editorSearchActive, editorHasMatches, searchIndex, searchNavigation]);

  useEffect(() => {
    if (isLargeDocument) return;
    if (!activeSearchQuery.trim() || !searchCount || !articleRef.current) return;
    articleRef.current.querySelectorAll('.active-search-hit').forEach((node) => node.classList.remove('active-search-hit'));
    const target = articleRef.current.querySelector(`[data-search-index="${searchIndex}"]`);
    target?.classList.add('active-search-hit');
    if (!restoringPositionRef.current) target?.scrollIntoView({ behavior: 'auto', block: 'center' });
  }, [renderedMarkdown, searchCount, searchIndex, searchNavigation, activeSearchQuery, isLargeDocument]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'k' && !sendOpen && !agentSettingsOpen && !setupOpen) { event.preventDefault(); setPaletteOpen((value) => !value); return; }
      if (paletteOpen) return;
      if (reviewRef.current || sendOpen || agentSettingsOpen || setupOpen) return;
      const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"], .ProseMirror');
      if (markPopover && !typing && ['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); removeAnnotation(markPopover.id); return; }
      if (!typing && (event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); openSendDialog(); return; }
      if (!typing && readingMode && selectionTools && selectedPassageRef.current && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // Fix carries any instruction. E still works: a Fix that already says "expand".
        const key = event.key.toLowerCase();
        const type = { f: 'fix', e: 'fix', d: 'delete', q: 'ask', i: 'fix', h: 'highlight', u: 'underline', n: 'note' }[key];
        if (type) { event.preventDefault(); startAnnotation(type, undefined, key === 'e' ? { note: language === 'zh' ? '展开写得更充分、更具体。' : 'Expand this: more depth and detail.' } : undefined); return; }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w') {
        event.preventDefault(); void closeTab(); return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault(); void reopenClosedTab(); return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Tab' && tabsRef.current.length > 1) {
        event.preventDefault();
        const index = tabsRef.current.findIndex((tab) => tab.id === activeDocumentRef.current.key);
        void switchTab(tabsRef.current[(index + (event.shiftKey ? -1 : 1) + tabsRef.current.length) % tabsRef.current.length].id); return;
      }
      if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault(); void navigateHistory(event.key === 'ArrowLeft' ? 'back' : 'forward'); return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setSidebarOpen(true); setSideMode('files');
        window.requestAnimationFrame(() => quickInputRef.current?.focus());
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); void openFilePicker(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') { event.preventDefault(); setPathOpen(true); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') {
        event.preventDefault(); setSidebarOpen(true); setSideMode('contents');
        requestAnimationFrame(() => document.querySelector('.outline-item.active, .outline-item')?.focus()); return;
      }
      if ((event.ctrlKey || event.metaKey) && ['=', '+', '-', '0'].includes(event.key)) {
        event.preventDefault(); const sizes = ['small', 'medium', 'large'];
        updateReadingPreference('fontSize', event.key === '0' ? 'medium' : sizes[Math.max(0, Math.min(2, sizes.indexOf(readingPreferences.fontSize) + (event.key === '-' ? -1 : 1)))]); return;
      }
      if (event.key === 'F3') { event.preventDefault(); moveSearchHit(event.shiftKey ? -1 : 1); return; }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        openSearch();
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOptionsDraft((value) => ({ ...value, scope: 'workspace' })); setSearchOpen(true);
        window.requestAnimationFrame(() => document.querySelector('.search-strip input')?.focus());
      }
      if (event.key === 'F9') {
        event.preventDefault();
        changeFocusMode(!focusMode);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && !readingMode) {
        event.preventDefault();
        editorRef.current?.flush();
        void saveCurrentFile();
      }
      const localInput = event.target.closest?.('input, textarea, [contenteditable]') && !event.target.closest?.('[data-edit-region]');
      if (!localInput && (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        const annotationContext = readingMode || event.target.closest?.('.redline-rail, .mark-popover');
        if (readingMode && !annotationContext) return;
        event.preventDefault();
        const redo = event.key.toLowerCase() === 'y' || event.shiftKey;
        if (annotationContext) changeAnnotationHistory(redo ? 'redo' : 'undo');
        else if (redo) redoEdit(); else undoEdit();
      }
      if (event.key === 'Escape') {
        closeSearch();
        setQuickQuery('');
        setLightbox(null);
        setHelpOpen(false);
        setPreferencesOpen(false);
        setRecentMenu(null);
        setDocumentMenuOpen(false);
        setPathOpen(false);
        setSelectionTools(null); setSelectionContextMenu(null); setNoteDialog(null); setCloseTabConfirmation(null); setMarkPopover(null);
        setVersionDialog(null); if (!conflictBusy) setConflictDialog(false); setLocationSuggestions([]);
        if (!deleteBusy) cancelSourceDeletion();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  async function normalizeImportedFile(file) {
    const name = file.name || '';
    if (/\.docx$/i.test(name)) {
      // Word charts keep their data; turn each into a Stetwise chart (see docx-charts.js).
      const { extractDocxCharts, insertCharts, restoreStetwiseObjects } = await import('./docx-charts');
      const original = await file.arrayBuffer();
      const extracted = await extractDocxCharts(original, language).catch(() => ({ buffer: original, charts: [] }));
      const result = await mammoth.convertToHtml({ arrayBuffer: extracted.buffer });
      return { content: restoreStetwiseObjects(insertCharts(htmlDocumentToMarkdown(result.value), extracted.charts)), kind: 'DOCX' };
    }
    if (/\.html?$/i.test(name)) {
      return { content: htmlDocumentToMarkdown(await file.text()), kind: 'HTML' };
    }
    return { content: await file.text(), kind: /\.txt$/i.test(name) ? 'TXT' : 'MD' };
  }

  async function openFilePicker() {
    if (!readingMode) commitInlineEdit({ lock: false, notify: false });
    if (window.mengxDesktop) {
      try { const handle = await chooseDesktopFile(fileHandlesRef.current.get(currentDocumentKey)); if (handle) await openFileObject(await handle.getFile(), handle, copy.localFile, handle.path); }
      catch (error) { console.error(error); setNotice(copy.openAgain); }
      return;
    }
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          mode: 'readwrite',
          multiple: false,
          types: [{
            description: 'Markdown and text',
            accept: { 'text/plain': ['.md', '.markdown', '.mdown', '.mkd', '.txt'], 'text/html': ['.html', '.htm'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] },
          }],
        });
        if (handle) {
          try { await handle.requestPermission?.({ mode: 'readwrite' }); } catch { /* read access remains usable */ }
          const file = await handle.getFile();
          await openFileObject(file, handle);
        }
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    fileInputRef.current?.click();
  }

  async function openFolderPicker() {
    if (!readingMode) commitInlineEdit({ lock: false, notify: false });
    if (window.mengxDesktop) {
      try { const directory = await chooseDesktopDirectory(); if (directory) await loadDirectory(directory); }
      catch (error) { console.error(error); setNotice(copy.openAgain); }
      return;
    }
    if (window.showDirectoryPicker) {
      try {
        const directory = await window.showDirectoryPicker({ mode: 'readwrite' });
        await loadDirectory(directory);
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    folderInputRef.current?.click();
  }

  async function loadDirectory(directory) {
    if (directory?.kind !== 'directory') throw new TypeError('A directory handle is required');
    directoryHandleRef.current = directory;
    if (directory.desktop) {
      clearAssetUrls();
      setAssetVersion((value) => value + 1);
      setWorkspaceRootName(directory.name);
      setWorkspaceFiles([]);
      setDesktopFolders(new Map());
      setExpandedWorkspaceFolders(new Set());
      desktopFolderLoadsRef.current.clear();
      const rows = await readDesktopFolder(directory, '');
      setNotice(`${directory.name} ${copy.folderOpened}`);
      return { ok: true, name: directory.name, fileCount: rows.filter((row) => row.kind === 'file').length, lazy: true };
    }
    const indexed = [], assets = [];
    async function visit(handle, prefix = '') {
      for await (const entry of handle.values()) {
        const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') await visit(entry, entryPath);
        else if (DOCUMENT_EXTENSIONS.test(entry.name)) indexed.push({ name: entry.name, path: entryPath,
          type: /\.txt$/i.test(entry.name) ? 'TXT' : /\.docx$/i.test(entry.name) ? 'DOCX' : /\.html?$/i.test(entry.name) ? 'HTML' : 'MD',
          time: 'just-now', active: false, size: 0, handle: entry, parentDirectory: handle });
        else if (/\.(png|jpe?g|gif|svg|webp|avif)$/i.test(entry.name)) assets.push({ path: entryPath, handle: entry });
      }
    }
    await visit(directory);
    setWorkspaceRootName(directory.name);
    setExpandedWorkspaceFolders(new Set());
    await mapDirectoryAssets(assets);
    setWorkspaceFiles(indexed.sort((a, b) => a.path.localeCompare(b.path)));
    setNotice(`${directory.name} ${copy.folderOpened}`);
    return { ok: true, name: directory.name, fileCount: indexed.length };
  }

  async function readDesktopFolder(directory, parent) {
    const root = directoryHandleRef.current;
    const rows = [], files = [];
    for await (const handle of directory.values()) {
      const relative = parent ? `${parent}/${handle.name}` : handle.name;
      if (handle.kind === 'directory') rows.push({ kind: 'folder', name: handle.name, path: relative, handle });
      else {
        const file = { name: handle.name, path: handle.path, relativePath: relative, handle,
          type: /\.txt$/i.test(handle.name) ? 'TXT' : /\.docx$/i.test(handle.name) ? 'DOCX' : /\.html?$/i.test(handle.name) ? 'HTML' : 'MD', time: 'just-now', size: 0 };
        files.push(file);
        rows.push({ kind: 'file', file });
      }
    }
    if (directoryHandleRef.current !== root) return [];
    setDesktopFolders((current) => new Map(current).set(parent, rows));
    setWorkspaceFiles((current) => [...current.filter((file) => !files.some((next) => next.path === file.path)), ...files]);
    return rows;
  }

  async function toggleWorkspaceFolder(row) {
    if (row.handle?.desktop && !desktopFolders.has(row.path)) {
      try {
        let task = desktopFolderLoadsRef.current.get(row.path);
        if (!task) { task = readDesktopFolder(row.handle, row.path); desktopFolderLoadsRef.current.set(row.path, task); }
        await task;
      } catch (error) { console.error(error); setNotice(copy.openAgain); return; }
      finally { desktopFolderLoadsRef.current.delete(row.path); }
    }
    setExpandedWorkspaceFolders((current) => { const next = new Set(current); if (next.has(row.path)) next.delete(row.path); else next.add(row.path); return next; });
  }

  async function allDesktopWorkspaceFiles() {
    const root = directoryHandleRef.current;
    const files = [];
    async function visit(directory, prefix = '') {
      for await (const handle of directory.values()) {
        const relative = prefix ? `${prefix}/${handle.name}` : handle.name;
        if (handle.kind === 'directory') await visit(handle, relative);
        else files.push({ name: handle.name, path: handle.path, relativePath: relative, handle });
      }
    }
    if (root?.desktop) await visit(root);
    return files;
  }

  async function openFileObject(file, handle = null, source = copy.localFile, path = null) {
    openRequestRef.current += 1;
    flushAutomaticSave();
    const displayPath = path || source;
    const key = documentCacheKey(file.name, displayPath);
    if (tabsRef.current.some((tab) => tab.id === key) && (tabSessionsRef.current.has(key) || activeDocumentRef.current.key === key)) {
      if (key !== activeDocumentRef.current.key) return openTextDocument({ name: file.name, path: displayPath });
      return { name: file.name, path: displayPath, revision: documentRevisionRef.current };
    }
    if (writerRef.current.jobs.has(key)) {
      await writerRef.current.jobs.get(key);
      if (handle) file = await handle.getFile();
    }
    const imported = await normalizeImportedFile(file);
    const content = imported.content;
    if (handle) {
      fileHandlesRef.current.set(key, handle);
      persistFileHandle(key, handle);
      if (['MD', 'TXT'].includes(imported.kind)) writerRef.current.register(key, handle, content);
    }
    return openTextDocument({ name: file.name, path: displayPath, content, kind: imported.kind, size: file.size });
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    openFileObject(file).catch(() => setNotice(copy.openFromDisk));
    event.target.value = '';
  }

  function importWorkspace(entries, { name = 'Workspace' } = {}) {
    directoryHandleRef.current = null;
    setDesktopFolders(new Map());
    const documents = entries.filter((entry) => DOCUMENT_EXTENSIONS.test(entry.file.name));
    const images = entries.filter((entry) => /\.(png|jpe?g|gif|svg|webp|avif)$/i.test(entry.file.name));
    clearAssetUrls();
    images.forEach(({ file, path }) => {
      const url = URL.createObjectURL(file);
      assetUrlsRef.current.push(url);
      const relative = path || file.webkitRelativePath || file.name;
      assetMapRef.current.set(normalizeResourceKey(relative), url);
      assetMapRef.current.set(normalizeResourceKey(file.name), url);
    });
    setAssetVersion((value) => value + 1);
    // Keep File objects; read a document only when it is opened or searched.
    const indexed = documents.map(({ file, path, handle }) => ({ name: file.name,
      path: path || file.webkitRelativePath || file.name, file, handle,
      type: /\.txt$/i.test(file.name) ? 'TXT' : /\.docx$/i.test(file.name) ? 'DOCX' : /\.html?$/i.test(file.name) ? 'HTML' : 'MD',
      time: 'just-now', active: false, size: file.size }));
    setWorkspaceRootName(name);
    setExpandedWorkspaceFolders(new Set());
    setWorkspaceFiles(indexed);
    setNotice(`${documents.length} ${copy.workspaceReady}`);
    return { name, fileCount: indexed.length, assetCount: images.length };
  }

  function handleFolderChange(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    importWorkspace(files.map((file) => ({ file, path: file.webkitRelativePath || file.name })),
      { name: files[0].webkitRelativePath.split('/')[0] || 'Workspace' });
  }

  async function openRecentFile(file) {
    const openKey = documentCacheKey(file.name, file.path);
    const knownHandle = file.handle || fileHandlesRef.current.get(openKey);
    if (tabsRef.current.some((tab) => tab.id === openKey) && !knownHandle && !file.file && (tabSessionsRef.current.has(openKey) || activeDocumentRef.current.key === openKey)) {
      return openTextDocument({ name: file.name, path: file.path, kind: file.type });
    }
    flushAutomaticSave();
    if (!readingMode) commitInlineEdit({ lock: false, notify: false });
    const key = documentCacheKey(file.name, file.path);
    await writerRef.current.jobs.get(key);
    if (dirtyDocumentsRef.current.has(key)) {
      return openTextDocument({ name: file.name, path: file.path, content: dirtyDocumentsRef.current.get(key), kind: file.type, saved: false });
    }
    const handle = file.handle || fileHandlesRef.current.get(key) || await restoreFileHandle(key);
    if (handle) {
      try {
        const permission = await handle.queryPermission?.({ mode: 'read' });
        if (permission !== 'granted' && handle.requestPermission) {
          const requested = await handle.requestPermission({ mode: 'read' });
          if (requested !== 'granted') {
            setNotice(copy.openAgain);
            return { ok: false, error: 'permission-denied' };
          }
        }
        const reopened = await handle.getFile();
        const imported = await normalizeImportedFile(reopened);
        fileHandlesRef.current.set(key, handle);
        persistFileHandle(key, handle);
        if (['MD', 'TXT'].includes(imported.kind)) writerRef.current.register(key, handle, imported.content);
        // A recent-file click is an explicit request to read the current file on disk.
        // Drop the in-memory tab snapshot so an external edit is reflected immediately.
        tabSessionsRef.current.delete(key);
        return openTextDocument({ name: reopened.name, path: file.path || copy.localFile, content: imported.content,
          kind: imported.kind, size: reopened.size, fresh: true });
      } catch {
        setNotice(copy.openAgain);
        return { ok: false, error: 'file-unavailable' };
      }
    }
    if (file.file) return openFileObject(file.file, null, file.path);
    const content = fileContentsRef.current.get(key) ?? fileContentsRef.current.get(normalizeResourceKey(file.name));
    if (content == null) {
      setNotice(copy.openAgain);
      return { ok: false, error: 'file-unavailable' };
    }
    const kind = file.type || (/\.txt$/i.test(file.name) ? 'TXT' : /\.docx$/i.test(file.name) ? 'DOCX' : /\.html?$/i.test(file.name) ? 'HTML' : 'MD');
    if (file.handle) {
      fileHandlesRef.current.set(key, file.handle);
      persistFileHandle(key, file.handle);
    }
    return openTextDocument({ name: file.name, path: file.path || copy.localFile, content, kind, size: file.size || new Blob([content]).size });
  }

  function removeRecentRecord(file) {
    const key = documentCacheKey(file.name, file.path);
    setRecentFiles((items) => items.filter((item) => documentCacheKey(item.name, item.path) !== key));
    delete loadReadingPositions()[key];
    window.localStorage.setItem('morrow-scroll-positions', JSON.stringify(scrollPositionsRef.current));
    forgetFileHandle(key);
    setRecentMenu(null);
    return { ok: true };
  }

  function clearRecentHistory() {
    recentFiles.forEach((file) => forgetFileHandle(documentCacheKey(file.name, file.path)));
    setRecentFiles([]);
    scrollPositionsRef.current = {};
    window.localStorage.removeItem('morrow-scroll-positions');
    setRecentMenu(null);
    return { ok: true };
  }

  function findRecentOrWorkspaceFile(pathOrIndex) {
    const file = typeof pathOrIndex === 'number' ? recentFiles[pathOrIndex] : [...recentFiles, ...workspaceFiles]
      .find((item) => item.path === pathOrIndex || documentCacheKey(item.name, item.path) === normalizeResourceKey(pathOrIndex));
    if (!file) throw new RangeError('Document record not found');
    return file;
  }

  async function requestSourceDeletion(file) {
    const key = documentCacheKey(file.name, file.path);
    const workspaceFile = workspaceFiles.find((item) => documentCacheKey(item.name, item.path) === key);
    const handle = file.handle || fileHandlesRef.current.get(key) || await restoreFileHandle(key);
    const parent = file.parentDirectory || workspaceFile?.parentDirectory;
    setRecentMenu(null);
    if (!parent?.removeEntry && typeof handle?.remove !== 'function') {
      setNotice(copy.deleteUnavailable);
      return { ok: false, error: 'source-deletion-unavailable' };
    }
    const prepared = await handle?.prepareRemoval?.();
    const candidate = { token: prepared?.token || crypto.randomUUID(), key, file, handle, parent, confirming: false };
    deleteCandidateRef.current = candidate;
    setDeleteConfirmation(candidate);
    return { ok: true, pending: true, token: candidate.token, name: file.name, path: file.path };
  }

  function cancelSourceDeletion() {
    if (deleteCandidateRef.current?.confirming) return { ok: false, error: 'deletion-in-progress' };
    deleteCandidateRef.current = null;
    setDeleteConfirmation(null);
    return { ok: true };
  }

  async function confirmSourceDeletion(token) {
    const candidate = deleteCandidateRef.current;
    if (!candidate || token !== candidate.token || candidate.confirming) return { ok: false, error: 'confirmation-required' };
    candidate.confirming = true;
    setDeleteBusy(true);
    const keys = new Set([candidate.key]);
    try {
      for (const [key, handle] of fileHandlesRef.current) {
        if (handle === candidate.handle || await handle.isSameEntry?.(candidate.handle)) keys.add(key);
      }
      window.clearTimeout(autoSaveTimerRef.current);
      await Promise.all([...keys].map((key) => writerRef.current.block(key)));
      const access = candidate.parent || candidate.handle;
      let permission = await access.queryPermission?.({ mode: 'readwrite' }) ?? 'granted';
      if (permission !== 'granted' && access.requestPermission) permission = await access.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') throw new Error('permission-denied');
      if (candidate.parent?.removeEntry) await candidate.parent.removeEntry(candidate.file.name);
      else await candidate.handle.remove(candidate.token);
      for (const key of keys) {
        fileHandlesRef.current.delete(key);
        writerRef.current.handles.delete(key);
        writerRef.current.baselines.delete(key);
        dirtyDocumentsRef.current.delete(key);
        fileContentsRef.current.delete(key);
        forgetFileHandle(key);
        delete loadReadingPositions()[key];
      }
      // Deleted source tabs remain readable, but can no longer write to disk.
      setTabVersion((value) => value + 1);
      setRecentFiles((items) => items.filter((file) => !keys.has(documentCacheKey(file.name, file.path))));
      setWorkspaceFiles((items) => items.filter((file) => !keys.has(documentCacheKey(file.name, file.path))));
      setDesktopFolders((current) => new Map([...current].map(([folder, rows]) => [folder, rows.filter((row) => row.kind !== 'file' || !keys.has(documentCacheKey(row.file.name, row.file.path)))])));
      window.localStorage.setItem('morrow-scroll-positions', JSON.stringify(scrollPositionsRef.current));
      if (keys.has(activeDocumentRef.current.key)) { setSaveState({ status: 'session' }); setDirtyMarkers(true); }
      deleteCandidateRef.current = null;
      setDeleteConfirmation(null);
      setNotice(copy.sourceDeleted);
      return { ok: true, name: candidate.file.name, path: candidate.file.path };
    } catch (error) {
      keys.forEach((key) => writerRef.current.blocked.delete(key));
      candidate.confirming = false;
      setNotice(copy.deleteError);
      return { ok: false, error: error.message || 'delete-failed' };
    } finally { setDeleteBusy(false); }
  }

  async function openReferencePicker() {
    if (window.mengxDesktop) {
      try {
        const handle = await chooseDesktopFile(fileHandlesRef.current.get(currentDocumentKey));
        if (handle) await window.mengxReader.openReference({ file: await handle.getFile(), handle, path: handle.path });
      } catch (error) { console.error(error); setNotice(copy.openAgain); }
      return;
    }
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: 'Documents', accept: { 'text/plain': ['.md', '.markdown', '.mdown', '.mkd', '.txt'], 'text/html': ['.html', '.htm'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } }],
        });
        if (!handle) return;
        const file = await handle.getFile();
        await openReference({ file, handle, path: file.name });
        setNotice(`${file.name} ${copy.opened}`);
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    splitFileInputRef.current?.click();
  }

  async function handleReferenceChange(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      await openReference({ file, path: file.name });
    } catch {
      setNotice(copy.openFromDisk);
    }
  }

  function commitInlineEdit({ lock = true, notify = true } = {}) {
    editorRef.current?.flush();
    if (editorDraftRef.current !== null || draftHtmlRef.current !== null || chunkDraftsRef.current.size) {
      const nextMarkdown = getDocumentSource();
      fileContentsRef.current.set(currentDocumentKey, nextMarkdown);
      if (!savedRef.current) dirtyDocumentsRef.current.set(currentDocumentKey, nextMarkdown);
      sourceBaseRef.current = nextMarkdown;
      setMarkdown(nextMarkdown);
      documentRevisionRef.current += 1;
      setFileMeta((meta) => ({ ...meta, size: new Blob([nextMarkdown]).size }));
      draftHtmlRef.current = null;
      chunkDraftsRef.current.clear();
      editorDraftRef.current = null;
      lastEditSnapshotRef.current = captureEditSnapshot();
    }
    if (lock) setReadingMode(true);
    if (notify) setNotice(copy.savedNotice);
  }

  function flushAutomaticSave() {
    window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = null;
    if (!savedRef.current) return saveCurrentFile({ automatic: true });
  }

  function scheduleAutomaticSave() {
    window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => { autoSaveTimerRef.current = null; void autoSaveHandlerRef.current?.(); }, 700);
  }

  async function saveCurrentFile({ automatic = false } = {}) {
    window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = null;
    if (automatic && savedRef.current) return { ok: true, unchanged: true };
    const snapshot = { ...activeDocumentRef.current, source: getDocumentSource(), version: editVersionsRef.current.get(activeDocumentRef.current.key) || 0 };
    dirtyDocumentsRef.current.set(snapshot.key, snapshot.source);
    try {
      const baseline = writerRef.current.baselines.get(snapshot.key);
      if (baseline !== undefined) await storeRecovery(snapshot.key, baseline, { saved: true, reason: 'before-save' });
      await storeRecovery(snapshot.key, snapshot.source);
    } catch (error) {
      const message = language === 'zh' ? '恢复草稿未能备份，已暂停写回原文件。请导出副本。' : 'Draft backup failed. Source writing is paused; export a copy.';
      setNotice(message);
      writerRef.current.change(snapshot.key, { status: 'error', version: snapshot.version, error: 'recovery-unavailable' });
      return { ok: false, error: 'recovery-unavailable', message: error instanceof Error ? error.message : String(error) };
    }
    const handle = fileHandlesRef.current.get(snapshot.key);
    if (handle && !writerRef.current.handles.has(snapshot.key)) writerRef.current.handles.set(snapshot.key, handle);
    return writerRef.current.save(snapshot, { requestPermission: !automatic });
  }

  async function showVersions() {
    const key = activeDocumentRef.current.key;
    try {
      const record = await recoveryVersions(key);
      if (activeDocumentRef.current.key === key) { setVersionToRestore(null); setVersionDialog(record); }
      return record;
    } catch { setNotice(language === 'zh' ? '版本存储不可用，请导出副本保留修改' : 'Recovery storage unavailable; export a copy'); return { ok: false, error: 'recovery-unavailable' }; }
  }

  async function restoreVersion(id = 'draft', { expectedRevision } = {}) {
    if (expectedRevision !== undefined && expectedRevision !== documentRevisionRef.current) throw Object.assign(new Error('Document revision conflict'), { code: 'revision-conflict' });
    const key = activeDocumentRef.current.key, revision = documentRevisionRef.current;
    const record = await getRecovery(key);
    if (key !== activeDocumentRef.current.key || revision !== documentRevisionRef.current) throw Object.assign(new Error('Document changed while loading a version'), { code: 'revision-conflict' });
    const version = id === 'draft' ? record.draft : record.versions.find((entry) => entry.id === id);
    if (!version) throw new RangeError('Recovery version not found');
    // Restore as a new edit; the bar offers Undo even in reading mode.
    const previous = getDocumentSource(), statuses = markSnapshot(key);
    applySource(version.source);
    showRound({ kind: 'version', key, previous, next: version.source, count: countChanges(previous, version.source), at: Date.now(), statuses });
    setVersionDialog(null); setRecoveryAvailable(false);
    return { ok: true, revision: documentRevisionRef.current };
  }

  async function resolveConflict(action, { expectedRevision } = {}) {
    if (expectedRevision !== undefined && expectedRevision !== documentRevisionRef.current) throw Object.assign(new Error('Document revision conflict'), { code: 'revision-conflict' });
    const key = activeDocumentRef.current.key, handle = fileHandlesRef.current.get(key);
    if (!handle) return { ok: false, error: 'file-handle-unavailable' };
    if (!['reload', 'overwrite'].includes(action)) throw new RangeError('Choose reload or overwrite');
    const revision = documentRevisionRef.current;
    await writerRef.current.jobs.get(key);
    const disk = (await normalizeImportedFile(await handle.getFile())).content;
    const hadUnsaved = !savedRef.current;
    await storeRecovery(key, getDocumentSource(), hadUnsaved ? undefined : { saved: true, reason: 'before-external' });
    if (activeDocumentRef.current.key !== key || revision !== documentRevisionRef.current) throw Object.assign(new Error('Document changed while resolving conflict'), { code: 'revision-conflict' });
    await storeRecovery(key, disk, { saved: true, reason: 'external-version' });
    if (activeDocumentRef.current.key !== key || revision !== documentRevisionRef.current) throw Object.assign(new Error('Document changed while resolving conflict'), { code: 'revision-conflict' });
    writerRef.current.register(key, handle, disk);
    externalMetadataRef.current.delete(key);
    if (action === 'reload') {
      getEditHistory().record(captureEditSnapshot());
      sourceBaseRef.current = disk; draftHtmlRef.current = null; chunkDraftsRef.current.clear(); editorDraftRef.current = null; resetRichEditor(); setMarkdown(disk);
      documentRevisionRef.current++; lastEditSnapshotRef.current = captureEditSnapshot();
      dirtyDocumentsRef.current.delete(key); setDirtyMarkers(true); setSaveState({ status: 'saved' }); setHistoryVersion((v) => v + 1);
      setFileMeta((meta) => ({ ...meta, size: new Blob([disk]).size, updated: 'just-now' }));
      setRecoveryAvailable(hadUnsaved);
      return { ok: true, revision: documentRevisionRef.current };
    }
    if (action === 'overwrite') return saveCurrentFile();
    throw new RangeError('Choose reload or overwrite');
  }

  async function resolveConflictFromUi(action) {
    setConflictBusy(true);
    try {
      const result = await resolveConflict(action, { expectedRevision: documentRevisionRef.current });
      if (result.ok) setConflictDialog(false);
      else setNotice(result.error || copy.saveFailed);
    } catch (error) { setNotice(error.message); }
    finally { setConflictBusy(false); }
  }

  // ---------- Rounds: follow outside changes, compare, undo a whole change ----------
  function isDocumentClean(key) {
    // Open editors are fine: once saved they hold nothing the file lacks, and they reload with the new text.
    return activeDocumentRef.current.key === key && savedRef.current && !dirtyDocumentsRef.current.has(key) && !writerRef.current.jobs.has(key) && !autoSaveTimerRef.current;
  }

  function markSnapshot(key) { return markStore.get(key).filter((item) => isRedline(item.type)).map(({ id, status, question, answer }) => ({ id, status, question, answer })); }
  function restoreMarkSnapshot(key, snapshot = []) {
    const byId = new Map(snapshot.map((item) => [item.id, item]));
    setMarkStatuses(new Map(markStore.get(key).filter((item) => byId.has(item.id)).map((item) => { const { status, question, answer } = byId.get(item.id); return [item.id, { status, question, answer }]; })), key);
  }
  function countChanges(before, after) { try { return diffBlocks(before, after).hunks.filter((hunk) => hunk.type === 'change').length; } catch { return 0; } }
  function showRound(next) { roundRef.current = next; setRound(next); }
  /**
   * Of the changes another program made, how many are in a paragraph the user had marked,
   * and how many are not. Null when there is nothing to check against (no instructions, or
   * a whole-document instruction, which covers every change).
   */
  function checkAgainstTasks(before, after, tasks) {
    if (!tasks?.length || tasks.some((task) => task.scope === 'document')) return null;
    try {
      const diff = diffBlocks(before, after), changes = diff.hunks.filter((hunk) => hunk.type === 'change');
      const unasked = changes.filter((hunk) => !tasksForHunk(diff, hunk, tasks).length).length;
      return { asked: changes.length - unasked, unasked };
    } catch { return null; }
  }
  // Session documents (samples, imports, the web) are not written to a file by themselves.
  function savesItself() { return fileHandlesRef.current.has(activeDocumentRef.current.key) && ['MD', 'TXT'].includes(activeDocumentRef.current.kind); }
  function savedHint() { return savesItself() ? (language === 'zh' ? '，会自动保存' : '; saving') : (language === 'zh' ? '。这篇是会话文档，记得导出保存' : '. This is a session document; export it to keep it'); }

  /** Briefly highlight the paragraphs that just changed. */
  function flashChanges(before, after) {
    if (!globalThis.CSS?.highlights || !globalThis.Highlight) return;
    let diff; try { diff = diffBlocks(before, after); } catch { return; }
    const blocks = diff.hunks.filter((hunk) => hunk.type === 'change').flatMap((hunk) => hunk.next.map((index) => diff.nextBlocks[index])).slice(0, 40);
    if (!blocks.length) return;
    window.clearTimeout(flashTimerRef.current);
    void waitForReader((api) => api.getState().document.ready).then(() => window.requestAnimationFrame(() => {
      const ranges = [];
      for (const block of blocks) {
        const holder = document.createElement('div');
        holder.innerHTML = safeMarkdown(block.text, '', () => '');
        const text = holder.textContent.trim().split('\n')[0].trim();
        if (!text) continue;
        const range = findRenderedAnchor(articleRef.current, { text, sourceOffset: block.start, displayPrefix: '', displaySuffix: '' }, documentAnalysis.chunks);
        if (range) ranges.push(range);
      }
      CSS.highlights.set('rl-external', new Highlight(...ranges));
      flashTimerRef.current = window.setTimeout(() => CSS.highlights.delete('rl-external'), 6000);
    })).catch(() => {});
  }

  /** The file changed on disk and nothing here is unsaved: show the new version. */
  function followExternalChange(key, handle, disk) {
    const previous = getDocumentSource(), current = roundRef.current;
    // Consecutive writes extend one round, so Compare shows everything since you last looked.
    const extend = current && current.key === key && current.kind === 'external' && !current.undone && current.next === previous;
    const since = extend ? current.previous : previous;
    void storeRecovery(key, previous, { saved: true, reason: 'before-external' }).then(() => storeRecovery(key, disk, { saved: true, reason: 'external', coalesceMs: 15000 })).catch(() => {});
    writerRef.current.register(key, handle, disk);
    getEditHistory().record(captureEditSnapshot());
    sourceBaseRef.current = disk; draftHtmlRef.current = null; chunkDraftsRef.current.clear(); editorDraftRef.current = null; resetRichEditor();
    setMarkdown(disk); fileContentsRef.current.set(key, disk);
    documentRevisionRef.current += 1;
    dirtyDocumentsRef.current.delete(key); setDirtyMarkers(true); setSaveState({ status: 'saved' }); setHistoryVersion((value) => value + 1);
    setFileMeta((meta) => ({ ...meta, size: new Blob([disk]).size, updated: 'just-now' }));
    lastEditSnapshotRef.current = captureEditSnapshot();
    const statuses = extend ? current.statuses : markSnapshot(key);
    // The instructions open when the change arrived, located in the text as it was then.
    let asked = []; try { asked = extend ? current.tasks || [] : buildTasks(since, markStore.get(key)); } catch { /* the change is followed without the check */ }
    // Instructions whose text is gone were acted on; Undo puts their status back.
    const gone = new Map(markStore.get(key).filter((item) => isRedline(item.type) && ['open', 'sent'].includes(item.status || 'open') && !item.anchor?.document && resolveTextAnchor(disk, item.anchor).orphaned).map((item) => [item.id, { status: 'resolved' }]));
    if (gone.size) setMarkStatuses(gone, key);
    showRound({ kind: 'external', key, previous: since, next: disk, count: countChanges(since, disk), writes: (extend ? current.writes : 0) + 1, at: Date.now(), since: extend ? current.since : Date.now(), statuses,
      tasks: asked, check: checkAgainstTasks(since, disk, asked) });
    setCompareView((view) => view && view.key === key && view.follow ? { ...view, proposed: disk, id: Date.now() } : view);
    flashChanges(previous, disk);
  }

  function openCompare({ base, proposed, label, readOnly = false, follow = false, tasks = [] }) {
    if (!readingMode) commitInlineEdit({ notify: false });
    setMarkPopover(null);
    setCompareView({ key: activeDocumentRef.current.key, mode: 'compare', origin: 'compare', base, proposed, sourceLabel: label, readOnly, follow, tasks,
      // With instructions to compare against, a change in a paragraph nobody marked is pointed out.
      checkAsked: tasks.length > 0 && !tasks.some((task) => task.scope === 'document'), answers: new Map(), id: Date.now() });
  }

  function compareRound() {
    const current = roundRef.current;
    if (!current || current.key !== activeDocumentRef.current.key) return;
    const since = new Date(current.kind === 'external' && current.since ? current.since : current.at).toLocaleTimeString();
    const label = current.kind === 'external' ? (language === 'zh' ? `外部程序 · ${since} 以来` : `another program · since ${since}`) : current.kind === 'review' ? current.source : roundLabel(current);
    openCompare({ base: current.previous, proposed: getDocumentSource(), label, follow: current.kind === 'external', tasks: current.kind === 'external' ? current.tasks || [] : [] });
  }

  /** Put one change of the round on screen back, from its popover in the text. The rest stay as they are. */
  function putBackChange(id) {
    const current = roundRef.current, zh = language === 'zh';
    setChangePopover(null);
    if (!current || !roundDiff || getDocumentSource() !== current.next) return;
    const final = composeReview(roundDiff.diff, { [id]: 'reject' });
    applySource(final);
    // An instruction this change had settled is open again once its text is back.
    const was = new Map((current.statuses || []).map((item) => [item.id, item]));
    setMarkStatuses(new Map(markStore.get(current.key).filter((item) => was.has(item.id) && item.status === 'resolved' && was.get(item.id).status !== 'resolved' && !resolveTextAnchor(final, item.anchor).orphaned)
      .map((item) => [item.id, { status: was.get(item.id).status || 'open' }])), current.key);
    showRound({ ...current, next: final, count: countChanges(current.previous, final), check: current.kind === 'external' ? checkAgainstTasks(current.previous, final, current.tasks) : current.check });
    setNotice((zh ? '已改回这一处' : 'Put that change back') + savedHint());
  }

  function revertFromCompare(final) {
    const view = compareView;
    if (!view) return;
    const previous = getDocumentSource();
    if (previous !== view.proposed) { setNotice(language === 'zh' ? '文档在对比期间又变了，请重新打开对比' : 'The document changed meanwhile; open Compare again'); setCompareView(null); return; }
    const statuses = markSnapshot(view.key);
    applySource(final);
    const count = countChanges(previous, final);
    showRound({ kind: 'revert', key: view.key, previous, next: final, count, at: Date.now(), statuses });
    setCompareView(null);
    setNotice((language === 'zh' ? `已改回 ${count} 处` : `Put back ${count} change${count === 1 ? '' : 's'}`) + savedHint());
  }

  function undoRound() {
    const current = roundRef.current;
    if (!current || current.undone || current.key !== activeDocumentRef.current.key) return;
    if (getDocumentSource() !== current.next) { setNotice(language === 'zh' ? '这之后文档又改过，不能整轮撤销；可以点「对比」逐处改回。' : 'The document changed since; use Compare to put back individual changes.'); return; }
    const after = markSnapshot(current.key);
    applySource(current.previous);
    restoreMarkSnapshot(current.key, current.statuses);
    showRound({ ...current, undone: true, statusesAfter: after, at: Date.now() });
    setNotice(current.kind === 'external'
      ? (language === 'zh' ? '已撤销，正在写回文件。如果外部程序还在改这个文件，它之后的写入会再次显示在这里。' : 'Undone and saving. If the other program is still editing, its next write will show here again.')
      : (language === 'zh' ? '已撤销' : 'Undone') + savedHint());
  }

  function redoRound() {
    const current = roundRef.current;
    if (!current?.undone || current.key !== activeDocumentRef.current.key) return;
    if (getDocumentSource() !== current.previous) { setNotice(language === 'zh' ? '这之后文档又改过，不能恢复这次修改' : 'The document changed since; cannot redo'); return; }
    applySource(current.next);
    if (current.statusesAfter) restoreMarkSnapshot(current.key, current.statusesAfter);
    showRound({ ...current, undone: false, at: Date.now() });
  }

  function roundLabel(current) {
    const zh = language === 'zh';
    if (current.kind === 'external') return zh ? '被外部修改了' : 'Changed outside';
    if (current.kind === 'review' && current.origin === 'external') return zh ? '已合并外部修改' : 'Merged outside changes';
    if (current.kind === 'review' && !current.count) return zh ? '审阅完成，没有写入修改' : 'Review finished; nothing written';
    if (current.kind === 'review') return zh ? `已写入 ${current.source} 的修改` : `Applied changes from ${current.source}`;
    if (current.kind === 'version') return zh ? '已恢复历史版本' : 'Restored a saved version';
    return zh ? '已改回' : 'Put back';
  }

  function serializeReview(value) {
    return { ...value, answers: [...(value.answers || new Map())], questions: [...(value.questions || new Map())] };
  }
  function reviveReview(value) {
    return { ...value, answers: new Map(value.answers || []), questions: new Map(value.questions || []) };
  }
  function rememberReviewProgress(progress) {
    const current = reviewRef.current;
    if (!current || !['agent', 'reply', 'external'].includes(current.origin)) return;
    current.progress = progress;
    window.clearTimeout(reviewProgressTimerRef.current);
    reviewProgressTimerRef.current = window.setTimeout(() => { void storePendingReview(current.key, serializeReview(current)).catch(() => {}); }, 500);
  }

  async function compareVersion(id) {
    const key = activeDocumentRef.current.key;
    const source = await versionSource(key, id);
    if (source === null) { setNotice(language === 'zh' ? '找不到这个版本' : 'Version not found'); return; }
    const entry = (await recoveryVersions(key)).versions.find((item) => item.id === id);
    setVersionDialog(null);
    openCompare({ base: source, proposed: getDocumentSource(), label: language === 'zh' ? `${entry ? new Date(entry.at).toLocaleString() : ''} 的版本 → 现在` : `Version from ${entry ? new Date(entry.at).toLocaleString() : ''} → now` });
  }

  function paletteCommands() {
    const zh = language === 'zh', has = tabs.length > 0, g = { file: zh ? '文件' : 'File', ai: 'AI', view: zh ? '视图' : 'View', export: zh ? '导出' : 'Export', history: zh ? '历史' : 'History', app: zh ? '设置' : 'Settings' };
    const items = [
      { id: 'open', group: g.file, label: zh ? '打开文档' : 'Open document', shortcut: `${mod} O`, run: () => void openFilePicker() },
      { id: 'folder', group: g.file, label: zh ? '打开文件夹' : 'Open folder', run: () => void openFolderPicker() },
      { id: 'path', group: g.file, label: zh ? '按路径打开' : 'Open by path', shortcut: `${mod} L`, run: () => setPathOpen(true) },
      { id: 'find-file', group: g.file, label: zh ? '在文件夹里找文档' : 'Find a document in the folder', shortcut: `${mod} P`, run: () => { setSidebarOpen(true); setSideMode('files'); window.requestAnimationFrame(() => quickInputRef.current?.focus()); } },
      { id: 'send', group: g.ai, label: zh ? '交给 AI 修改' : 'Send to AI', shortcut: `${mod} ↵`, disabled: !has, run: () => openSendDialog() },
      { id: 'send-options', group: g.ai, label: zh ? '交给 AI 修改：选择 AI 和权限范围' : 'Send to AI: choose the AI and scope', disabled: !has, run: () => openSendDialog(null, { options: true }) },
      { id: 'review-command', group: g.ai, label: zh ? '复制「请我审」的命令，给终端里的 AI' : 'Copy the review command for my terminal AI', keywords: 'cli terminal claude codex stetwise-review', run: () => void copyReviewCommand() },
      { id: 'copy-task', group: g.ai, label: zh ? '复制成任务，贴给终端里的 AI' : 'Copy as a task for my terminal AI', disabled: !has, run: () => void copyTaskForTerminal() },
      { id: 'whole', group: g.ai, label: zh ? '全文指令' : 'Whole-document instruction', disabled: !has, keywords: 'instruction', run: () => { const created = addAnnotation('free', { anchor: { text: '', rawQuote: '', document: true, sourceOffset: 0, sourceEnd: 0 }, label: zh ? '全文' : 'Whole document' }); openMarkPopover(created.id, null, { focus: true }); } },
      { id: 'agents', group: g.ai, label: zh ? 'AI 工具设置' : 'AI tools', run: () => setAgentSettingsOpen(true) },
      { id: 'find', group: g.view, label: zh ? '在文档中查找' : 'Find in document', shortcut: `${mod} F`, disabled: !has, run: () => openSearch() },
      { id: 'mode', group: g.view, label: readingMode ? (zh ? '切换到编辑' : 'Switch to editing') : (zh ? '切换到阅读' : 'Switch to reading'), disabled: !has, run: () => toggleReadingMode() },
      { id: 'source', group: g.view, label: sourceView ? (zh ? '返回排版视图' : 'Formatted view') : (zh ? '查看 Markdown 源文件' : 'View Markdown source'), disabled: !has, run: () => void changeSourceView(!sourceView) },
      { id: 'split', group: g.view, label: splitView ? (zh ? '关闭并排阅读' : 'Close side by side') : (zh ? '并排阅读' : 'Side by side'), disabled: !has, run: () => (splitView ? closeSplit() : void openReferencePicker()) },
      { id: 'focus', group: g.view, label: zh ? '专注阅读' : 'Focus reading', shortcut: 'F9', disabled: !has, run: () => changeFocusMode(!focusMode) },
      { id: 'stats', group: g.view, label: zh ? '文档统计' : 'Document statistics', disabled: !has, run: () => setStatsOpen(true) },
      { id: 'history', group: g.history, label: zh ? '版本历史' : 'Version history', disabled: !has, run: () => { setSidebarOpen(true); setSideMode('history'); } },
      { id: 'compare-last', group: g.history, label: zh ? '对比最近一次修改' : 'Compare the latest change', disabled: !has, run: () => void latestChangeBase().then((found) => found ? openCompare({ base: found.base, proposed: getDocumentSource(), label: found.label }) : setNotice(zh ? '还没有 AI 修改或外部修改的记录' : 'No AI or outside change recorded yet')) },
      { id: 'md', group: g.export, label: zh ? '导出 Markdown' : 'Export Markdown', disabled: !has, run: () => void exportDraft() },
      { id: 'pdf', group: g.export, label: zh ? '保存 PDF' : 'Save PDF', disabled: !has || Boolean(pdfProgress), run: () => setPdfOptions(readPdfOptions()) },
      { id: 'word', group: g.export, label: zh ? '导出 Word' : 'Export Word', disabled: !has, run: () => void exportWord() },
      { id: 'word-tracked', group: g.export, label: zh ? '导出带修订的 Word' : 'Export Word with tracked changes', keywords: 'revision track changes 修订', disabled: !has, run: () => void exportWord({ revisions: true }) },
      { id: 'report', group: g.export, label: zh ? '导出修改记录' : 'Export change log', disabled: !has, run: () => void exportChangeReport() },
      { id: 'rich', group: g.export, label: zh ? '复制为富文本' : 'Copy as formatted text', keywords: 'copy clipboard 飞书 钉钉 notion', disabled: !has, run: () => void copyRichText() },
      { id: 'marks', group: g.export, label: zh ? '导出标记 JSON' : 'Export marks as JSON', disabled: !has, run: () => void exportAnnotations() },
      { id: 'language', group: g.app, label: zh ? '界面语言：切换到 English' : 'Interface language: switch to 中文 (Chinese)', keywords: 'language 语言 english chinese 中文', run: () => setLanguage(zh ? 'en' : 'zh') },
      { id: 'theme-dark', group: g.app, label: zh ? '深色模式' : 'Dark theme', keywords: 'dark theme 夜间 暗色', run: () => setTheme('dark') },
      { id: 'theme-light', group: g.app, label: zh ? '浅色模式' : 'Light theme', keywords: 'light theme 白天', run: () => setTheme('light') },
      { id: 'theme-system', group: g.app, label: zh ? '外观跟随系统' : 'Follow system appearance', keywords: 'system theme', run: () => setTheme('system') },
      { id: 'sepia', group: g.app, label: readingPreferences.background === 'sepia' ? (zh ? '正文改回白色底' : 'White page') : (zh ? '护眼米色底' : 'Sepia page'), keywords: 'sepia eye 护眼', run: () => updateReadingPreference('background', readingPreferences.background === 'sepia' ? 'white' : 'sepia') },
      { id: 'setup', group: g.app, label: zh ? '默认应用与 AI' : 'Default app and AI', hidden: !window.mengxDesktop?.system, run: () => setSetupOpen(true) },
    ];
    return items;
  }

  async function exportAnnotations() {
    const data = { redline: 1, document: fileName, sourcePath: fileMeta.source, marks: getAnnotations() };
    const handle = fileHandlesRef.current.get(activeDocumentRef.current.key);
    if (handle?.desktop) {
      try { const result = await window.mengxDesktop.writeSidecar(handle.id, JSON.stringify(data)); setNotice((language === 'zh' ? 'JSON 已保存：' : 'JSON saved: ') + result.path); return result; }
      catch (error) { setNotice(error.message); return { ok: false, error: error.message }; }
    }
    return exportBlob(fileName.replace(/\.[^.]+$/, '') + '.annotations.json', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  }

  async function exportBlob(name, blob) {
    if (window.mengxDesktop) return saveDesktopExport(name, blob);
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { ok: true, name };
  }

  function toggleReadingMode() {
    if (readingMode) {
      setMarkPopover(null);
      startRichPart();
      setReadingMode(false);
      return;
    }
    richPartRef.current = null; setRichPart(null);
    commitInlineEdit();
  }

  function updateReadingPreference(name, value) {
    setReadingPreferences((current) => normalizeReadingPreferences({ ...current, [name]: value }));
    return value;
  }

  async function openAddressPath(path = locationDraft) {
    const value = path.trim();
    setLocationSuggestions([]); setLocationFocused(false);
    if (!value) return { ok: false, error: 'empty-path' };
    try {
      if (window.mengxDesktop && isNativePath(value)) {
        const handle = await openDesktopPath(value);
        if (handle.kind === 'directory') return loadDirectory(handle);
        return apiOpenFile(handle);
      }
      const recent = recentFiles.find((item) => item.path === value || documentCacheKey(item.name, item.path) === normalizeResourceKey(value));
      const workspace = workspaceFiles.find((item) => item.path === value || item.relativePath === value);
      if (recent || workspace) return openRecentFile(recent || workspace);
      throw new Error('path-not-found');
    } catch (error) {
      setNotice(copy.addressOpenError);
      return { ok: false, error: error.message || 'path-not-found' };
    }
  }

  useEffect(() => {
    if (!locationFocused) { setLocationSuggestions([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const value = locationDraft.trim();
      let suggestions = recentFiles.filter((file) => isNativePath(file.path) && file.path.toLowerCase().startsWith(value.toLowerCase()))
        .map((file) => ({ name: file.name, path: file.path, kind: 'file' }));
      if (window.mengxDesktop?.completePath && value) {
        try { suggestions = await window.mengxDesktop.completePath(value); } catch { /* Recent paths remain available. */ }
      }
      if (!cancelled) { setLocationSuggestions(suggestions.slice(0, 40)); setLocationSuggestionIndex(-1); }
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [locationDraft, locationFocused, recentFiles]);

  function chooseLocationSuggestion(item) {
    setLocationDraft(item.path + (item.kind === 'directory' ? '\\' : ''));
    setLocationSuggestions([]); setLocationSuggestionIndex(-1);
    if (item.kind === 'file') void openAddressPath(item.path);
  }

  function resizeSidebar(event) {
    if (event.type === 'pointerdown') {
      sidebarResizeRef.current = { x: event.clientX, width: sidebarWidth, next: sidebarWidth };
      event.currentTarget.setPointerCapture(event.pointerId);
    } else if (sidebarResizeRef.current) {
      const next = Math.max(220, Math.min(480, event.currentTarget.parentElement.clientWidth * .45, sidebarResizeRef.current.width + event.clientX - sidebarResizeRef.current.x));
      sidebarResizeRef.current.next = next;
      event.currentTarget.closest('.app-shell').style.setProperty('--sidebar-width', `${next}px`);
      if (event.type !== 'pointermove') { setSidebarWidth(next); sidebarResizeRef.current = null; }
    }
  }

  /** Save an export: next to the document on desktop (with Show in folder), a download on the web. */
  async function saveExportFile(name, blob, label, detail = '') {
    const zh = language === 'zh';
    if (window.mengxDesktop) {
      const handle = fileHandlesRef.current.get(activeDocumentRef.current.key);
      const result = await saveDesktopExport(name, blob, { documentId: handle?.desktop ? handle.id : undefined, title: zh ? `导出${label}` : `Export ${label}` });
      if (result?.ok) setActionToast({ message: `${zh ? `已导出${label}` : `${label} exported`}${detail}：${result.path}`, label: zh ? '在文件夹中显示' : 'Show in folder', run: () => void window.mengxDesktop.revealExport(result.path).catch((error) => setNotice(error.message)), at: Date.now() });
      return result;
    }
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; link.rel = 'noopener'; link.style.display = 'none';
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    setNotice(zh ? `已下载${label}${detail}` : `${label} downloaded${detail}`);
    return { ok: true, name, bytes: blob.size };
  }

  const exportBase = () => fileName.replace(/\.(?:md|mdown|mkd|txt|markdown|html?|docx)$/i, '');

  async function exportDraft() {
    const source = getDocumentSource();
    const blob = new Blob([source], { type: 'text/markdown;charset=utf-8' });
    // Saving next to an .md document must not suggest overwriting it.
    const copyName = ['MD', 'TXT'].includes(activeDocumentRef.current.kind) && window.mengxDesktop ? (language === 'zh' ? '（副本）' : ' (copy)') : '';
    return saveExportFile(exportBase() + copyName + '.md', blob, ' Markdown');
  }

  /** Copy the document as formatted text for Feishu, DingTalk, WeCom, Notion, email. */
  async function copyRichText() {
    const source = getDocumentSource();
    // Without our internal attributes, so the pasted result is plain, clean formatting.
    const html = `<meta charset="utf-8">${safeMarkdown(source, '', (path) => resolveDocumentAsset(path)).replace(/\s(?:data-[\w-]+|class|id)="[^"]*"/g, '')}`;
    const holder = document.createElement('div'); holder.innerHTML = html;
    const text = holder.innerText || source;
    try {
      if (window.mengxDesktop?.copyRich) await window.mengxDesktop.copyRich(html, text);
      else await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      setNotice(language === 'zh' ? '已复制为富文本，可以直接粘贴到飞书、钉钉、企业微信、Notion 或邮件里' : 'Copied as formatted text; paste into Notion, Docs or email');
      return { ok: true };
    } catch (error) { setNotice((language === 'zh' ? '复制失败：' : 'Copy failed: ') + error.message); return { ok: false, error: error.message }; }
  }

  /** Word comments for the instructions on the current text: what was asked, its state, the AI's answer. */
  function instructionComments(source) {
    const zh = language === 'zh', blocks = splitBlocks(source), numbers = numberRedlines(getAnnotations());
    return getAnnotations().filter((item) => isRedline(item.type) && !item.anchor?.orphaned).map((item) => {
      const lines = [`#${numbers.get(item.id) || ''} ${typeLabel(language, item.type)}${zh ? '：' : ': '}${item.note || (zh ? '（没有写要求）' : '(no instruction)')}`, `${zh ? '状态' : 'Status'}${zh ? '：' : ': '}${rt(language, item.status || 'open')}`];
      if (item.answer) lines.push(`${zh ? 'AI 的回答' : 'AI answer'}${zh ? '：' : ': '}${item.answer}`);
      if (item.question) lines.push(`${zh ? 'AI 的疑问' : 'AI question'}${zh ? '：' : ': '}${item.question}`);
      return { block: item.anchor?.document ? 0 : blockAt(blocks, item.anchor.sourceOffset), text: lines.join('\n') };
    });
  }

  /** The text before the latest AI or outside change: the base for tracked changes. */
  async function latestChangeBase() {
    const key = activeDocumentRef.current.key, current = roundRef.current, source = getDocumentSource();
    if (current && current.key === key && !current.undone && current.previous !== source) return { base: current.previous, label: roundLabel(current) };
    const record = await getRecovery(key);
    const version = [...record.versions].reverse().find((entry) => ['before-ai', 'before-external'].includes(entry.reason) && entry.source !== source);
    return version ? { base: version.source, label: new Date(version.at).toLocaleString() } : null;
  }

  async function exportChangeReport(base = null, current = getDocumentSource()) {
    const zh = language === 'zh';
    if (base === null) { const found = await latestChangeBase(); if (!found) { setNotice(zh ? '还没有 AI 修改或外部修改的记录。可以在「保存版本与恢复」里选一个版本对比后导出。' : 'No AI or outside change recorded yet. Compare a saved version and export from there.'); return { ok: false }; } base = found.base; }
    const diff = diffBlocks(base, current), quote = (text) => text.trim().split('\n').map((line) => `> ${line}`).join('\n') || '> ∅';
    const out = [`# ${zh ? '修改记录' : 'Change log'}：${documentTitle}`, '', `${zh ? '生成时间' : 'Generated'}：${new Date().toLocaleString()}`, ''];
    let n = 0;
    for (const hunk of diff.hunks) {
      if (hunk.type !== 'change') continue;
      n++;
      out.push(`## ${zh ? '修改' : 'Change'} ${n}`, '', `**${zh ? '之前' : 'Before'}**`, '', quote(hunk.base.map((i) => diff.baseBlocks[i].text).join('')), '', `**${zh ? '之后' : 'After'}**`, '', quote(hunk.next.map((i) => diff.nextBlocks[i].text).join('')), '');
    }
    if (!n) out.push(zh ? '没有修改。' : 'No changes.', '');
    const marks = getAnnotations().filter((item) => isRedline(item.type)), numbers = numberRedlines(marks);
    if (marks.length) {
      out.push(`## ${zh ? '指令' : 'Instructions'}`, '');
      for (const item of marks) {
        out.push(`- **#${numbers.get(item.id)} ${typeLabel(language, item.type)}** · ${rt(language, item.status || 'open')} · 「${(item.anchor?.document ? (zh ? '全文' : 'whole document') : item.anchor?.text || '').replace(/\s+/g, ' ').slice(0, 60)}」${item.note ? ` — ${item.note.replace(/\s+/g, ' ')}` : ''}`);
        if (item.answer) out.push(`  - ${zh ? 'AI 的回答' : 'AI answer'}：${item.answer.replace(/\s+/g, ' ')}`);
        if (item.question) out.push(`  - ${zh ? 'AI 的疑问' : 'AI question'}：${item.question.replace(/\s+/g, ' ')}`);
      }
      out.push('');
    }
    return saveExportFile(exportBase() + (zh ? '-修改记录.md' : '-changes.md'), new Blob([out.join('\n')], { type: 'text/markdown;charset=utf-8' }), zh ? '修改记录' : ' change log');
  }

  // Word export: charts and diagrams become pictures with their data table below.
  async function exportWord({ revisions = false, base = null } = {}) {
    if (revisions && base === null) {
      const found = await latestChangeBase();
      if (!found) { setNotice(zh ? '还没有 AI 修改或外部修改的记录。可以在「保存版本与恢复」里选一个版本对比后导出。' : 'No AI or outside change recorded yet. Compare a saved version and export from there.'); return { ok: false }; }
      base = found.base;
    }
    const name = exportBase() + (revisions ? (zh ? '-修订.docx' : '-tracked.docx') : '.docx');
    setNotice(zh ? '正在导出 Word…' : 'Exporting Word…');
    try {
      const [{ markdownToDocx }, { renderMermaidSvg }] = await Promise.all([import('./docx-export'), import('./mermaid-renderer')]);
      const loadImage = async (src) => {
        const url = /^(?:data:|blob:|https?:)/i.test(src) ? src : resolveDocumentAsset(src);
        if (!url) return null;
        const response = await fetch(url); if (!response.ok) return null;
        return new Uint8Array(await response.arrayBuffer());
      };
      const source = getDocumentSource();
      const { blob, warnings } = await markdownToDocx({ source, base: revisions ? base : null, comments: revisions ? instructionComments(source) : [], title: documentTitle, language, loadImage, renderMermaid: renderMermaidSvg });
      const detail = warnings.length ? (zh ? `（${warnings.length} 张图片没能读取，已用文字代替）` : ` (${warnings.length} image(s) replaced with text)`) : '';
      return await saveExportFile(name, blob, revisions ? (zh ? '带修订的 Word' : ' Word with tracked changes') : ' Word', detail);
    } catch (error) {
      console.error('Word export failed:', error);
      setNotice(zh ? `导出 Word 失败：${error.message}` : `Word export failed: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  function cancelPdf() {
    if (!pdfBusyRef.current) return { ok: true, cancelled: false };
    pdfCancelRef.current = true;
    pdfWorkerRef.current?.cancel();
    setPdfProgress((value) => value ? { ...value, label: copy.pdfCancelling } : null);
    return { ok: true, cancelled: true };
  }

  function readPdfOptions() {
    try { return { paper: 'A4', pageNumbers: true, ...JSON.parse(localStorage.getItem('stetwise-pdf-options') || '{}') }; } catch { return { paper: 'A4', pageNumbers: true }; }
  }

  async function exportPdf(options = readPdfOptions()) {
    if (pdfBusyRef.current) return { ok: false, error: 'busy' };
    try { localStorage.setItem('stetwise-pdf-options', JSON.stringify({ paper: options.paper, pageNumbers: options.pageNumbers })); } catch { /* optional */ }
    pdfBusyRef.current = true;
    const startedAt = performance.now();
    const jobRecord = { name: fileName, startedAt, cancelled: false };
    const source = getDocumentSource();
    const exportName = fileName.replace(/\.(?:md|mdown|mkd|txt|markdown|html?|docx)$/i, '') + '.pdf';
    const title = documentTitle;
    pdfCancelRef.current = false;
    setPdfProgress({ value: 0, label: copy.pdfPreparing, pages: 0 });
    await yieldToBrowser();
    try {
      if (pdfCancelRef.current) return { ok: false, cancelled: true };
      {
        const worker = new Worker(new URL('./pdf.worker.js', import.meta.url), { type: 'module' });
        const payload = await new Promise((resolve, reject) => {
          pdfWorkerRef.current = { worker, cancel: () => {
            worker.terminate();
            reject(new DOMException('Cancelled', 'AbortError'));
          } };
          worker.onmessage = async ({ data }) => {
            if (data.type === 'progress') setPdfProgress({ value: data.value, pages: data.pages,
              label: data.phase === 'font' ? copy.pdfLoadingFont : data.phase === 'finish' ? copy.pdfFinishing : copy.pdfPreparing });
            if (data.type === 'done') resolve(data);
            if (data.type === 'error') reject(new Error(data.message));
            if (data.type === 'diagram') {
              try {
                const { renderMermaidSvg } = await import('./mermaid-renderer');
                const svg = await renderMermaidSvg(data.source);
                if (!pdfCancelRef.current) worker.postMessage({ type: 'diagram-result', id: data.id, svg });
              } catch (error) { if (!pdfCancelRef.current) worker.postMessage({ type: 'diagram-result', id: data.id, error: error.message }); }
            }
          };
          worker.onerror = (event) => reject(new Error(event.message || copy.pdfError));
          worker.postMessage({ source, title, paper: options.paper, pageNumbers: options.pageNumbers, assets: [...assetMapRef.current.entries()], resourceBase: fileHandlesRef.current.get(currentDocumentKey)?.desktop ? fileHandlesRef.current.get(currentDocumentKey).resourceUrl('') : null,
            fontUrl: new URL(`${import.meta.env.BASE_URL}fonts/NotoSansSC-Regular.ttf`, window.location.href).href });
        });
        const { buffer, pages, stats } = payload;
        jobRecord.pages = pages; jobRecord.stats = stats;
        if (pdfCancelRef.current) return { ok: false, cancelled: true };
        const result = await saveExportFile(exportName, new Blob([buffer], { type: 'application/pdf' }), ' PDF', language === 'zh' ? `（${pages} 页）` : ` (${pages} pages)`);
        return { ...result, pages, stats };
      }
    } catch (error) {
      if (error.name !== 'AbortError') { console.error('PDF export failed:', error); setNotice(copy.pdfError); return { ok: false, error: error.message || 'pdf-failed' }; }
      return { ok: false, cancelled: true };
    } finally {
      jobRecord.cancelled = Boolean(pdfCancelRef.current);
      jobRecord.finishedAt = performance.now();
      jobRecord.durationMs = Math.round(jobRecord.finishedAt - startedAt);
      performanceRef.current.pdfJobs.push(jobRecord);
      performanceRef.current.pdfJobs = performanceRef.current.pdfJobs.slice(-20);
      pdfWorkerRef.current?.worker.terminate();
      pdfWorkerRef.current = null;
      pdfBusyRef.current = false;
      setPdfProgress(null);
    }
  }

  function captureEditSnapshot() {
    return { markdown: sourceBaseRef.current, html: draftHtmlRef.current, chunks: new Map(chunkDraftsRef.current),
      sourceMode: sourceView, selection: captureEditSelection(articleRef.current), scrollTop: readingScrollRef.current?.scrollTop || 0 };
  }

  function getEditHistory() {
    const key = activeDocumentRef.current.key;
    if (!editHistoriesRef.current.has(key)) editHistoriesRef.current.set(key, new EditHistory());
    return editHistoriesRef.current.get(key);
  }

  function handleBeforeInput(event) {
    if (readingMode) return;
    beforeInputRef.current = captureEditSnapshot();
    if (['historyUndo', 'historyRedo'].includes(event.nativeEvent.inputType)) {
      event.preventDefault();
      if (event.nativeEvent.inputType === 'historyUndo') undoEdit(); else redoEdit();
    }
  }

  function markCurrentEdited() {
    documentRevisionRef.current += 1;
    const key = activeDocumentRef.current.key;
    editVersionsRef.current.set(key, (editVersionsRef.current.get(key) || 0) + 1);
    setDirtyMarkers(false);
    setSaveState({ status: 'pending' });
    setHistoryVersion((value) => value + 1);
    setTabVersion((value) => value + 1);
    scheduleAutomaticSave();
  }

  function recordInput(region, inputType) {
    const before = beforeInputRef.current || lastEditSnapshotRef.current;
    const group = !inputType || ['insertText', 'deleteContentBackward', 'deleteContentForward', 'insertCompositionText'].includes(inputType) ? region : null;
    getEditHistory().record(before, { group });
    beforeInputRef.current = null;
    lastEditSnapshotRef.current = captureEditSnapshot();
    markCurrentEdited();
  }

  function handleArticleInput(event) {
    draftHtmlRef.current = event.currentTarget.innerHTML;
    recordInput('article', event.nativeEvent.inputType);
    // Contenteditable mutations can leave CSS Highlights attached to removed nodes.
    // Repaint on the next render so marks remain visible while editing.
    setAnnotationVersion((value) => value + 1);
  }

  function handleChunkInput(chunk, node, plain) {
    let source;
    if (plain) source = node.textContent;
    else {
      source = htmlToMarkdown(node.innerHTML) + '\n\n';
      for (const [label, definition] of Object.entries(documentAnalysis.referenceDefinitions || {})) {
        if (definition.start < chunk.start || definition.start >= chunk.end) continue;
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!new RegExp(`^ {0,3}\\[${escaped}\\]:`, 'mi').test(source)) source += sourceBaseRef.current.slice(definition.start, definition.end) + '\n';
      }
    }
    chunkDraftsRef.current.set(chunk.start, { start: chunk.start, end: chunk.end, source, ...(plain ? {} : { html: node.innerHTML }) });
    recordInput(String(chunk.start));
    setAnnotationVersion((value) => value + 1);
  }

  function restoreSnapshot(snapshot) {
    const changedView = Boolean(snapshot.sourceMode) !== sourceView;
    const position = changedView ? getReadingPosition() : null;
    if (changedView) {
      let source = snapshot.html !== null && snapshot.html !== undefined ? htmlToMarkdown(snapshot.html) : snapshot.markdown;
      for (const draft of [...snapshot.chunks.values()].sort((a, b) => b.start - a.start)) source = source.slice(0, draft.start) + draft.source + source.slice(draft.end);
      snapshot = { ...snapshot, markdown: source, html: null, chunks: new Map(), selection: null, sourceMode: sourceView };
    }
    sourceBaseRef.current = snapshot.markdown;
    editorDraftRef.current = null; resetRichEditor();
    draftHtmlRef.current = snapshot.html;
    chunkDraftsRef.current = new Map(snapshot.chunks);
    lastEditSnapshotRef.current = snapshot;
    beforeInputRef.current = null;
    setMarkdown(snapshot.markdown);
    markCurrentEdited();
    if (snapshot.selection && !articleRef.current?.querySelector(`[data-edit-region="${CSS.escape(snapshot.selection.region)}"]`)) {
      if (readingScrollRef.current) readingScrollRef.current.scrollTop = snapshot.scrollTop || 0;
    }
    let attempts = 0;
    const restore = () => {
      if (readingMode || attempts++ > 30) return;
      if (!restoreEditSelection(articleRef.current, snapshot.selection)) window.requestAnimationFrame(restore);
    };
    window.requestAnimationFrame(restore);
    if (position) void waitForReader((api) => api.getState().document.ready).then(() => window.mengxReader.restoreReadingPosition(position));
    return { ok: true, revision: documentRevisionRef.current };
  }

  // Long documents are edited one part at a time; the rest of the source is kept verbatim.
  function currentReadingOffset() {
    const position = readingNavigationRef.current?.getPosition?.();
    return position?.sourceOffset ?? position?.sourceStart ?? position?.anchor?.sourceOffset ?? headingsBySlug.get(activeOutline)?.offset ?? 0;
  }

  function startRichPart(offset = currentReadingOffset(), index = null) {
    const source = getDocumentSource();
    const parts = editableParts(source);
    const chosen = index ?? partAt(parts, offset);
    const part = { ...parts[Math.max(0, Math.min(parts.length - 1, chosen))], index: Math.max(0, Math.min(parts.length - 1, chosen)), count: parts.length, parts, base: source };
    richPartRef.current = part;
    setRichPart(part);
    setEditorKey((value) => value + 1);
    return part;
  }

  function switchRichPart(index) {
    editorRef.current?.flush();
    if (editorDraftRef.current !== null) commitInlineEdit({ lock: false, notify: false });
    startRichPart(0, index);
    requestAnimationFrame(() => readingScrollRef.current?.scrollTo({ top: 0 }));
  }

  function handleRichChange(slice) {
    const part = richPartRef.current;
    if (!part) return;
    const source = part.base.slice(0, part.start) + slice + part.base.slice(part.end);
    if (source === getDocumentSource()) return;
    editorDraftRef.current = source;
    markCurrentEdited();
  }

  function undoEdit() {
    if (readingMode) return { ok: false, error: 'reading-locked' };
    // The editor undoes what was typed in it. A change made around it (a restored version, an
    // inserted total row, the automation API) is in the document's own history: without this
    // fallback, undo did nothing for those while still reporting success.
    if (usingRichEditor && editorRef.current?.undo()) return { ok: true, revision: documentRevisionRef.current };
    const snapshot = getEditHistory().undo(captureEditSnapshot());
    return snapshot ? restoreSnapshot(snapshot) : { ok: false, error: 'nothing-to-undo' };
  }

  function redoEdit() {
    if (readingMode) return { ok: false, error: 'reading-locked' };
    if (usingRichEditor && editorRef.current?.redo()) return { ok: true, revision: documentRevisionRef.current };
    const snapshot = getEditHistory().redo(captureEditSnapshot());
    return snapshot ? restoreSnapshot(snapshot) : { ok: false, error: 'nothing-to-redo' };
  }

  function scrollToHeading(item) {
    setCollapsedHeadings((current) => {
      const next = new Set(current); let parent = item.parent;
      while (parent !== null && parent !== undefined) { next.delete(outline[parent].slug); parent = outline[parent].parent; }
      return next;
    });
    rememberNavigation();
    restoringPositionRef.current = false;
    if (item === outline[0] && item.level === 1) {
      readingScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
      setActiveOutline(item.slug);
      return;
    }
    if (sourceView) {
      readingNavigationRef.current?.goToSource(item.offset);
      setActiveOutline(item.slug);
      return;
    }
    if (isLargeDocument) {
      setHeadingTarget({ source: markdown, item, request: performance.now() });
      setActiveOutline(item.slug);
      return;
    }
    const target = articleRef.current?.querySelector(`[data-heading="${CSS.escape(item.slug)}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveOutline(item.slug);
  }

  function handleArticleClick(event) {
    if (!event.ctrlKey && !event.metaKey && !window.getSelection()?.toString().trim()) {
      const hit = hitTestMarks(paintedMarksRef.current, event.clientX, event.clientY);
      if (hit) {
        event.preventDefault();
        openMarkPopover(hit.item.id, hit.range.getBoundingClientRect());
        return;
      }
    }
    const link = event.target.closest('a[href]');
    if (link?.getAttribute('href')?.startsWith('#')) {
      event.preventDefault();
      const hash = decodeURIComponent(link.getAttribute('href').slice(1));
      const heading = outline.find((item) => item.slug === hash || item.slug.replace(/-\d+$/, '') === hash.toLowerCase());
      if (heading) scrollToHeading(heading);
      else {
        const target = articleRef.current?.querySelector(`[id="${CSS.escape(hash)}"]`);
        if (target) { rememberNavigation(); target.scrollIntoView({ block: 'center' }); }
      }
      return;
    }
    if (link) { event.preventDefault(); void openDocumentLink(link.getAttribute('href')); return; }
    if (!link && !event.target.closest('img') && !event.ctrlKey && !event.metaKey && !window.getSelection()?.toString().trim() && roundChangesRef.current.length) {
      const changed = hitTestMarks(roundChangesRef.current, event.clientX, event.clientY);
      if (changed) {
        const box = changed.range.getClientRects()[0] || changed.range.getBoundingClientRect();
        setMarkPopover(null); setChangePopover({ id: changed.item.id, rect: { left: box.left, top: box.top, bottom: Math.min(changed.range.getBoundingClientRect().bottom, window.innerHeight - 120), right: box.right } });
        return;
      }
    }
    const image = event.target.closest('img');
    if (image) {
      setLightbox({ src: image.currentSrc || image.src, alt: image.alt || '', source: image.dataset.source, handle: fileHandlesRef.current.get(currentDocumentKey), key: `${currentDocumentKey}:${image.dataset.source || image.src}` });
      return;
    }
    const heading = event.target.closest('[data-heading]');
    if (heading) setActiveOutline(heading.dataset.heading);
    const searchHit = event.target.closest('[data-search-index]');
    if (searchHit) setSearchIndex(Number(searchHit.dataset.searchIndex) || 0);
  }

  function getAnnotations() {
    const source = getDocumentSource();
    return markStore.get(activeDocumentRef.current.key).map((item) => ({ ...item, anchor: resolveTextAnchor(source, item.anchor) }));
  }

  function recordAnnotationChange(previous) {
    const key = activeDocumentRef.current.key;
    const history = annotationHistoriesRef.current.get(key) || { past: [], future: [] };
    history.past.push(previous); history.future = [];
    let size = history.past.reduce((total, snapshot) => total + JSON.stringify(snapshot).length * 2, 0);
    while (history.past.length > 1 && (history.past.length > 80 || size > 8 * 1024 * 1024)) size -= JSON.stringify(history.past.shift()).length * 2;
    annotationHistoriesRef.current.set(key, history);
  }

  function changeAnnotationHistory(direction) {
    const key = activeDocumentRef.current.key, history = annotationHistoriesRef.current.get(key);
    const from = direction === 'undo' ? history?.past : history?.future;
    const snapshot = from?.at(-1);
    if (!snapshot) return { ok: false, error: direction === 'undo' ? 'nothing-to-undo' : 'nothing-to-redo' };
    const current = markStore.get(key);
    markStore.set(key, snapshot);
    from.pop(); (direction === 'undo' ? history.future : history.past).push(current);
    setActiveAnnotation(null); setMarkPopover(null); setAnnotationVersion((value) => value + 1);
    return { ok: true, count: snapshot.length };
  }

  function getCurrentBookmark() {
    const source = getDocumentSource();
    const position = readingNavigationRef.current?.getPosition() ?? readingScrollRef.current?.scrollTop ?? 0;
    const visibleHeadings = [...(articleRef.current?.querySelectorAll('[data-heading]') || [])];
    const top = readingScrollRef.current?.getBoundingClientRect().top || 0;
    const visible = visibleHeadings.find((node) => node.getBoundingClientRect().top >= top - 8);
    const heading = outline.find((item) => item.slug === visible?.dataset.heading);
    const offset = position?.sourceStart ?? heading?.offset ?? 0;
    const quote = source.slice(offset, offset + 100).trimEnd();
    return {
      anchor: { text: quote, rawQuote: quote, sourceOffset: offset, sourceEnd: offset + quote.length,
        prefix: source.slice(Math.max(0, offset - 48), offset), suffix: source.slice(offset + quote.length, offset + quote.length + 48) },
      position,
    };
  }

  function markRail(type) { return isRedline(type) ? 'redlines' : 'marks'; }

  function openMarkPopover(id, rect, { focus = false } = {}) {
    const box = rect || articleRef.current?.getBoundingClientRect();
    setMarkPopover({ id, rect: box ? { left: box.left, top: box.top, bottom: box.bottom, right: box.right } : { left: 200, top: 200, bottom: 220, right: 300 }, focus });
    const mark = markStore.get(activeDocumentRef.current.key).find((item) => item.id === id);
    if (mark) setRailMode(markRail(mark.type));
    setActiveAnnotation(id);
    setSelectionTools(null); setSelectionContextMenu(null);
  }

  /** Create a mark from the current selection in one step: no naming dialog. */
  function startAnnotation(type, anchor = selectedPassageRef.current, { note } = {}) {
    if (!MARK_TYPES.includes(type)) throw new RangeError('Invalid annotation type');
    if (type === 'bookmark') { addAnnotation('bookmark', {}); return; }
    if (!anchor) { setNotice(language === 'zh' ? '请先选择一段正文' : 'Select a passage first'); return; }
    const rect = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0).getBoundingClientRect() : null;
    // The same instruction on the same words again: open the one that is there instead of adding a copy.
    const source = getDocumentSource();
    const twin = markStore.get(activeDocumentRef.current.key).find((item) => item.type === type && item.anchor?.rawQuote === anchor.rawQuote && !item.anchor?.document
      && resolveTextAnchor(source, item.anchor).sourceOffset === anchor.sourceOffset && (!isRedline(type) || ['open', 'sent', 'unchanged', 'question'].includes(item.status || 'open')));
    if (twin) { window.getSelection()?.removeAllRanges(); openMarkPopover(twin.id, rect, { focus: true }); setNotice(language === 'zh' ? '这段文字已经有同样的标记，已为你打开' : 'This passage already has that mark; opened it'); return; }
    const created = addAnnotation(type, { anchor, label: anchor.text, ...(note ? { note } : {}) });
    window.getSelection()?.removeAllRanges();
    if (isRedline(type) || type === 'note') openMarkPopover(created.id, rect, { focus: true });
  }

  function editAnnotation(item) {
    goToAnnotation(item.id).then(() => {
      const range = findRenderedAnchor(articleRef.current, item.anchor, documentAnalysis.chunks);
      openMarkPopover(item.id, range?.getBoundingClientRect(), { focus: true });
    }).catch(() => {});
  }

  function addAnnotation(type, options = {}) {
    if (!MARK_TYPES.includes(type)) throw new RangeError('Invalid annotation type');
    if (!tabsRef.current.length) throw new Error('Open a document first');
    const source = getDocumentSource();
    let anchor = options.anchor || selectedPassageRef.current;
    if (options.text) anchor = createTextAnchor(source, { text: options.text, sourceOffset: options.sourceOffset || 0,
      regionStart: Math.max(0, (options.sourceOffset || 0) - 4000), regionEnd: Math.min(source.length, (options.sourceOffset || 0) + 80000) });
    const bookmark = type === 'bookmark' && !anchor ? getCurrentBookmark() : null;
    anchor = bookmark?.anchor || anchor;
    if (!anchor) throw new Error('Select a passage first');
    const defaultLabel = type === 'bookmark' ? ([...outline].reverse().find((item) => item.offset <= anchor.sourceOffset)?.text || documentTitle) : anchor.text;
    const item = { id: crypto.randomUUID(), type, anchor, label: String(options.label || defaultLabel || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      note: String(options.note || '').slice(0, 10000), createdAt: Date.now(), ...(isRedline(type) ? { status: 'open' } : {}),
      ...(type === 'bookmark' ? { position: options.position ?? bookmark?.position ?? readingNavigationRef.current?.getPosition() ?? readingScrollRef.current?.scrollTop ?? 0 } : {}) };
    const previous = markStore.get(activeDocumentRef.current.key);
    if (previous.length >= 2000) throw new Error('This document already has 2000 marks');
    markStore.set(activeDocumentRef.current.key, [...previous, item]);
    recordAnnotationChange(previous);
    setAnnotationVersion((value) => value + 1); setRailMode(markRail(type)); setOutlineOpen(true); setActiveAnnotation(item.id);
    setSelectionTools(null); setSelectionContextMenu(null); selectedPassageRef.current = null;
    return { ok: true, ...item };
  }

  async function copySelectedText(text) {
    const value = String(text || '');
    if (!value) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        const selection = window.getSelection();
        document.execCommand('copy');
        if (!selection?.toString()) throw new Error('copy-failed');
      }
      setNotice(language === 'zh' ? '已复制' : 'Copied');
    } catch {
      setNotice(language === 'zh' ? '复制失败' : 'Copy failed');
    }
    setSelectionContextMenu(null);
  }

  async function cutSelectedText(text) {
    if (readingMode) return;
    const value = String(text || '');
    if (!value) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) throw new Error('selection-missing');
      if (!document.execCommand('delete')) selection.deleteFromDocument();
      setNotice(language === 'zh' ? '已剪切' : 'Cut');
    } catch {
      setNotice(language === 'zh' ? '剪切失败' : 'Cut failed');
    }
    setSelectionContextMenu(null);
    setSelectionTools(null);
  }

  function openSelectionNote(anchor = selectedPassageRef.current) {
    startAnnotation('note', anchor);
  }

  function removeAnnotation(id, { toast = true } = {}) {
    const previous = markStore.get(activeDocumentRef.current.key);
    if (!previous.some((item) => item.id === id)) throw new RangeError('Annotation not found');
    markStore.set(activeDocumentRef.current.key, previous.filter((item) => item.id !== id));
    recordAnnotationChange(previous);
    if (toast) setUndoToast({ message: rt(language, 'removed'), at: Date.now() });
    setAnnotationVersion((value) => value + 1);
    if (activeAnnotation === id) setActiveAnnotation(null);
    if (markPopover?.id === id) setMarkPopover(null);
    return { ok: true, id };
  }

  function updateAnnotation(id, patch = {}) {
    const previous = markStore.get(activeDocumentRef.current.key);
    if (!previous.some((item) => item.id === id)) throw new RangeError('Annotation not found');
    const { note, label, type, status, answer } = patch;
    if (type !== undefined && !MARK_TYPES.includes(type)) throw new RangeError('Invalid annotation type');
    markStore.set(activeDocumentRef.current.key, previous.map((item) => item.id === id ? { ...item,
      ...(note !== undefined ? { note: String(note).slice(0, 10000) } : {}), ...(label !== undefined ? { label: String(label).slice(0, 160) } : {}),
      ...(type !== undefined ? { type, status: isRedline(type) ? (item.status && isRedline(item.type) ? item.status : 'open') : undefined } : {}),
      ...(status !== undefined ? { status } : {}), ...(answer !== undefined ? { answer } : {}) } : item));
    recordAnnotationChange(previous);
    setAnnotationVersion((value) => value + 1);
    if (type !== undefined) setRailMode(markRail(type));
    return { ok: true, id };
  }

  // ---------- Stetwise: AI round trip ----------
  function currentTasks(source = getDocumentSource(), statuses) {
    return buildTasks(source, markStore.get(activeDocumentRef.current.key), statuses ? { includeStatuses: statuses } : undefined);
  }

  // The last finished AI round on each document, for the next task on it (see roundRecord).
  const LAST_ROUNDS = 'stetwise-last-rounds-v1';
  function lastRound(key = activeDocumentRef.current.key) {
    try { const found = JSON.parse(localStorage.getItem(LAST_ROUNDS) || '{}')[key]; return found && Date.now() - found.at < 14 * 86400000 ? found.entries : []; } catch { return []; }
  }
  function rememberRound(key, entries) {
    try {
      const all = JSON.parse(localStorage.getItem(LAST_ROUNDS) || '{}');
      if (entries.length) all[key] = { at: Date.now(), entries }; else delete all[key];
      // Only the most recent documents are kept.
      const recent = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 40);
      localStorage.setItem(LAST_ROUNDS, JSON.stringify(Object.fromEntries(recent)));
    } catch { /* storage unavailable: the next task goes without it */ }
  }

  function promptFor(mode, scope = 'file', onlyIds = null, note = '') {
    const source = getDocumentSource();
    let tasks = currentTasks(source, onlyIds ? REDLINE_STATUS : undefined);
    if (onlyIds) tasks = tasks.filter((task) => onlyIds.includes(task.id));
    // Anchors go into a working copy only; never into the user's own file (folder scope).
    const anchors = mode === 'agent' && scope !== 'folder' ? anchorDocument(source, tasks) : null;
    return { source, tasks, anchors, prompt: buildPrompt({ mode, language, name: fileName, file: fileName, source, tasks, scope, note, anchors, previous: mode === 'agent' ? lastRound() : [] }) };
  }

  /** Read an AI result back: drop anchors and set aside anything changed outside them. */
  function scopedReview(base, proposed, anchors) {
    if (!anchors?.enabled) return { proposed: stripAnchors(proposed) };
    const result = resolveAnchors(base, anchors, proposed);
    // Offered only when the AI really changed text outside the selections. Spacing it tidied
    // around a deletion is not such a change (the scoped result is tidied here as well).
    return { proposed: result.scoped, unscoped: result.outside.length ? result.full : undefined, outside: result.outside, anchorMissing: result.missing };
  }

  function setMarkStatuses(updates, key = activeDocumentRef.current.key) {
    const previous = markStore.get(key);
    if (!updates.size) return;
    markStore.set(key, previous.map((item) => updates.has(item.id) ? { ...item, ...updates.get(item.id), updatedAt: Date.now() } : item));
    if (key === activeDocumentRef.current.key) recordAnnotationChange(previous);
    setAnnotationVersion((value) => value + 1);
  }

  function markSent(tasks, agent, key) { setMarkStatuses(new Map(tasks.map((task) => [task.id, { status: 'sent', sentTo: agent?.name || 'AI', sentAt: Date.now() }])), key); }

  function tasksToSend(onlyIds = null) {
    return currentTasks(undefined, onlyIds ? REDLINE_STATUS : undefined).filter((task) => !onlyIds || onlyIds.includes(task.id));
  }
  /** options: true opens the dialog to choose the AI and scope; otherwise the last choice is used when there is one. */
  function openSendDialog(onlyIds = null, { options = false } = {}) {
    if (!tabsRef.current.length) return;
    if (['starting', 'running'].includes(agentRunRef.current?.status)) { setNotice(language === 'zh' ? '请先停止或完成当前 AI 任务' : 'Stop or finish the current run first'); return; }
    const tasks = currentTasks(undefined, onlyIds ? REDLINE_STATUS : undefined).filter((task) => !onlyIds || onlyIds.includes(task.id));
    if (!tasks.length) { setNotice(rt(language, 'nothingToSend')); return; }
    setMarkPopover(null);
    setSendOpen({ onlyIds, quick: !options });
  }

  /** Save a sample, imported or unsaved document as .md, open that file with the same marks, then send. */
  async function saveAsMarkdownAndSend() {
    const zh = language === 'zh', oldKey = activeDocumentRef.current.key, marks = markStore.get(oldKey), onlyIds = sendOpen?.onlyIds || null;
    const result = await saveDesktopExport(exportBase() + '.md', new Blob([getDocumentSource()], { type: 'text/markdown;charset=utf-8' }), { title: zh ? '另存为 Markdown' : 'Save as Markdown' });
    if (!result?.ok) return;
    try {
      const record = await window.mengxDesktop.openExported(result.path);
      const handle = desktopHandle(record);
      await window.stetwiseReader.openFile({ file: await handle.getFile(), handle, path: handle.path });
      const newKey = activeDocumentRef.current.key;
      if (newKey !== oldKey && marks.length && !markStore.get(newKey).length) { markStore.set(newKey, marks.map((item) => ({ ...item }))); setAnnotationVersion((value) => value + 1); }
      setSendOpen(false);
      window.setTimeout(() => openSendDialog(onlyIds), 50);
      setNotice(zh ? `已另存为 ${result.path}，标记也一起带过来了` : `Saved as ${result.path}; marks came along`);
    } catch (error) { setNotice(error.message); }
  }

  /**
   * The open instructions as text for an AI the user already has running in a terminal. It
   * edits the real file there, with everything it already knows from that conversation;
   * Stetwise follows the file and checks the changes against these instructions.
   */
  /** The open instructions written as a task for an AI in a terminal, or null (with a notice saying why). */
  async function terminalTask() {
    const zh = language === 'zh';
    const tasks = tasksToSend();
    if (!tasks.length) { setNotice(rt(language, 'nothingToSend')); return null; }
    const handle = fileHandlesRef.current.get(activeDocumentRef.current.key);
    if (!handle?.desktop || !handle.path || !['MD', 'TXT'].includes(activeDocumentRef.current.kind)) {
      setNotice(zh ? '终端里的 AI 要直接改文件，所以这篇文档得先存成本机的 .md 文件。' : 'The AI in your terminal edits the file itself, so this document has to be saved as a local .md file first.'); return null;
    }
    // What the AI reads from disk must be what the instructions were written against.
    if (!readingMode) commitInlineEdit({ notify: false });
    if (dirtyDocumentsRef.current.has(activeDocumentRef.current.key)) await window.stetwiseReader.save();
    return { tasks, task: buildPrompt({ mode: 'terminal', language, name: fileName, file: handle.path, source: getDocumentSource(), tasks, note: '', previous: lastRound() }) };
  }


  const samePath = (a, b) => Boolean(a && b) && String(a).replace(/\\/g, '/').toLowerCase() === String(b).replace(/\\/g, '/').toLowerCase();
  const terminalReview = terminalReviews.find((request) => samePath(request.path, fileHandlesRef.current.get(currentDocumentKey)?.path)) || null;
  /** Answer the terminal AI that asked for this review: with the open instructions, or with "nothing to change". */
  async function answerTerminalReview(status) {
    const zh = language === 'zh', request = terminalReview;
    if (!request) return;
    try {
      let text = zh ? '用户在 Stetwise 里看过这篇文档，没有要改的地方。不要修改它。' : 'The user reviewed this document in Stetwise and asked for no changes. Do not modify it.';
      let count = 0;
      if (status === 'notes') { const built = await terminalTask(); if (!built) return; text = built.task; count = built.tasks.length; }
      await window.mengxDesktop.reviewReply(request.folder, status, text);
      setTerminalReviews((list) => list.filter((item) => item.folder !== request.folder));
      setNotice(status === 'notes' ? (zh ? `已把 ${count} 条指令发回终端。它改文件时这里会显示改动，并核对有没有多改。` : `Sent ${count} instruction${count === 1 ? '' : 's'} back to the terminal. Its changes will show here, checked against what you asked for.`) : (zh ? '已告诉终端里的 AI：不用改。' : 'Told the AI in your terminal: nothing to change.'));
    } catch (error) { setNotice(error.message); }
  }

  /** The command an AI in a terminal runs to ask for a review, with a sentence telling it when. */
  async function copyReviewCommand() {
    const zh = language === 'zh';
    try {
      const found = await window.mengxDesktop?.reviewCommand?.();
      if (!found?.ok) { setNotice(zh ? '这个命令随安装版提供（便携版和开发模式里没有）。' : 'This command comes with the installed app (not the portable build or development mode).'); return; }
      const line = `"${found.command}" "<path to the .md file>"`;
      const text = zh
        ? `需要我审一份 Markdown 文档（方案、规格、草稿）时，运行下面的命令并等它结束。它会在 Stetwise 里打开这个文件，我在里面标出要改的地方；我发回之后，命令会输出我的指令。然后请直接修改那个文件来执行这些指令，只改指令涉及的地方。\n\n${line}`
        : `When I should review a Markdown file (a plan, a spec, a draft), run the command below and wait for it to finish. It opens the file in Stetwise, where I mark what should change; when I send them back, the command prints my instructions. Then carry them out by editing that file, changing only what they ask for.\n\n${line}`;
      if (window.mengxDesktop?.copyText) await window.mengxDesktop.copyText(text); else await navigator.clipboard.writeText(text);
      setNotice(zh ? '已复制。贴进你的 CLAUDE.md、AGENTS.md，或直接发给终端里的 AI。' : 'Copied. Paste it into your CLAUDE.md or AGENTS.md, or straight to the AI in your terminal.');
    } catch (error) { setNotice(error.message); }
  }

  async function copyTaskForTerminal() {
    const zh = language === 'zh';
    try {
      const built = await terminalTask();
      if (!built) return;
      const { tasks, task } = built;
      if (window.mengxDesktop?.copyText) await window.mengxDesktop.copyText(task); else await navigator.clipboard.writeText(task);
      setNotice(zh ? `已复制 ${tasks.length} 条指令。贴给终端里的 AI，它改文件时这里会显示改动，并核对有没有多改。` : `Copied ${tasks.length} instruction${tasks.length === 1 ? '' : 's'}. Paste into the AI in your terminal; its changes will show here, checked against what you asked for.`);
    } catch (error) { setNotice(error.message); }
  }

  function canRunLocalAgent() {
    const handle = fileHandlesRef.current.get(activeDocumentRef.current.key);
    return Boolean(window.mengxDesktop?.agents && handle?.desktop && ['MD', 'TXT'].includes(activeDocumentRef.current.kind));
  }

  async function startAgent({ agent, scope, note = '', quick = false }) {
    const onlyIds = sendOpen?.onlyIds || null;
    setSendOpen(false);
    if (quick) setNotice(language === 'zh' ? `已交给 ${agent.name}（${scope === 'folder' ? '文档所在文件夹' : '只改这篇文档'}）。要换 AI 或范围，点发送按钮旁边的选项。` : `Sent to ${agent.name} (${scope === 'folder' ? 'the document folder' : 'this document only'}). To change the AI or scope, use the options button next to Send.`);
    if (agent.kind === 'manual') { setManualTransfer({ onlyIds, key: activeDocumentRef.current.key }); return; }
    if (agentStartingRef.current || ['starting', 'running'].includes(agentRunRef.current?.status)) return;
    agentStartingRef.current = true;
    commitInlineEdit({ lock: false, notify: false });
    const key = activeDocumentRef.current.key, handle = fileHandlesRef.current.get(key), bridge = window.mengxDesktop?.agents;
    let run;
    try {
      if (!canRunLocalAgent()) throw new Error(rt(language, 'desktopOnly'));
      await flushAutomaticSave(); await writerRef.current.jobs.get(key);
      if (activeDocumentRef.current.key !== key) throw new Error('文档已切换，请在目标文档重新发送');
      if (!savedRef.current) { const saved = await saveCurrentFile(); if (saved?.ok === false) throw new Error(saved.error || copy.saveFailed); }
      const source = getDocumentSource(), { tasks, prompt, anchors } = promptFor('agent', scope, onlyIds, note), settings = readAgentSettings();
      if (!tasks.length) throw new Error(rt(language, 'nothingToSend'));
      await storeRecovery(key, source, { saved: true, reason: 'before-ai' });
      run = { id: null, agent, tasks, base: source, key, scope, status: 'starting', output: '', startedAt: Date.now(), anchors: anchors?.enabled ? { enabled: true, anchors: anchors.anchors, wholeDocument: anchors.wholeDocument } : null };
      agentRunRef.current = run; setAgentRun(run); markSent(tasks, agent, key);
      const result = await bridge.run({ adapterId: agent.kind === 'custom' ? null : agent.id, documentId: handle.id, scope, task: prompt, tasks,
        copyText: run.anchors ? anchors.text : null, anchors: run.anchors?.anchors || null,
        custom: agent.kind === 'custom' ? { template: agent.template, name: agent.name } : null, overrides: settings.overrides, timeoutMinutes: settings.timeoutMinutes });
      if (agentRunRef.current === run || agentRunRef.current?.id === result.id) {
        run.id = result.id; run.pid = result.pid;
        if (run.anchors && !result.anchored) run.anchors = null;
        if (run.status === 'starting') run.status = 'running';
        if (agentRunRef.current?.status === 'starting' || agentRunRef.current === run) { agentRunRef.current = run; setAgentRun({ ...run }); }
      }
      return { ok: true, id: result.id };
    } catch (error) {
      if (run) { run.status = 'failed'; run.finishedAt = Date.now(); run.diagnostic = { message: error.message }; agentRunRef.current = run; setAgentRun({ ...run }); setMarkStatuses(new Map(run.tasks.map((task) => [task.id, { status: 'open', sentTo: undefined }])), run.key); }
      setNotice(rt(language, 'runFailed') + ': ' + error.message); return { ok: false, error: error.message };
    } finally { agentStartingRef.current = false; }
  }

  /** Per-instruction progress, read from the working copy the AI is saving. */
  function runProgress(run, content) {
    const clean = stripAnchors(content);
    const changed = countChanges(run.base, clean);
    if (!run.anchors?.anchors?.length) return { items: [], changed };
    const asks = new Set(run.tasks.filter((task) => task.type === 'ask').map((task) => task.n)), items = [];
    for (const anchor of run.anchors.anchors) {
      const open = content.indexOf(anchorOpen(anchor.n)), close = open < 0 ? -1 : content.indexOf(anchorClose(anchor.n), open);
      const status = open < 0 || close < 0 ? 'missing' : content.slice(open + anchorOpen(anchor.n).length, close) !== run.base.slice(anchor.start, anchor.end) ? 'done' : 'pending';
      for (const n of anchor.members) if (!asks.has(n)) items.push({ n, status });
    }
    for (const task of run.tasks) if (task.scope === 'document') items.push({ n: task.n, status: changed ? 'done' : 'pending' });
    return { items: items.sort((a, b) => a.n - b.n), changed };
  }

  agentEventsRef.current = {
    current(id) { const run = agentRunRef.current; if (!run || (run.id && run.id !== id)) return null; if (!run.id && run.status !== 'starting') return null; run.id = id; return run; },
    output({ id, text }) { const run = this.current(id); if (!run) return; run.output = (run.output + text).slice(-200000); setAgentRun({ ...run }); },
    status(data) { const run = this.current(data.id); if (!run) return; Object.assign(run, data); setAgentRun({ ...run }); },
    progress({ id, content }) {
      const run = this.current(id); if (!run || !['starting', 'running'].includes(run.status) || typeof content !== 'string') return;
      run.live = content; run.progress = runProgress(run, content); setAgentRun({ ...run });
    },
    done(data) {
      const run = this.current(data.id); if (!run) return;
      const finished = { ...run, ...data, output: data.output || run.output, finishedAt: Date.now(), status: data.cancelled ? 'cancelled' : data.code === 0 ? 'done' : 'failed' };
      ({ answers: finished.answers, questions: finished.questions } = parseReply(data.reply || finished.output));
      if (run.scope === 'folder') finished.diskBaseline = data.proposed;
      finished.hasChanges = typeof data.proposed === 'string' && stripAnchors(data.proposed) !== run.base;
      agentRunRef.current = finished; setAgentRun(finished);
      setCompareView((view) => view?.readOnly ? null : view);
      const zh = language === 'zh';
      if (!data.cancelled) {
        // Say which document, how much changed and whether the AI is asking something.
        const documentName = tabsRef.current.find((tab) => tab.id === run.key)?.name || 'Stetwise';
        const changed = typeof data.proposed === 'string' ? countChanges(run.base, stripAnchors(data.proposed)) : 0, asked = finished.questions?.size || 0;
        const body = finished.status === 'done'
          ? (zh ? `${run.agent.name} ${changed ? `改完了 ${changed} 处` : '没有改动文档'}${asked ? `，有 ${asked} 个疑问` : ''}。点这里回来审阅。` : `${run.agent.name} ${changed ? `changed ${changed} place${changed === 1 ? '' : 's'}` : 'made no changes'}${asked ? `, with ${asked} question${asked === 1 ? '' : 's'}` : ''}. Click to review.`)
          : (zh ? `${run.agent.name} 没有完成：${finished.diagnostic?.messages?.zh || finished.diagnostic?.message || '请查看运行日志'}` : `${run.agent.name} did not finish: ${finished.diagnostic?.messages?.en || finished.diagnostic?.message || 'see the run log'}`);
        void window.mengxDesktop?.attention?.(documentName, body)?.catch?.(() => {});
      }
      if (finished.status !== 'done') { setMarkStatuses(new Map(run.tasks.map((task) => [task.id, { status: 'open', sentTo: undefined }])), run.key); return; }
      if (typeof data.proposed !== 'string') { finished.status = 'failed'; finished.diagnostic = { message: zh ? 'AI 未留下可读取的文档结果，请查看日志' : 'The AI left no readable document; see the log' }; setAgentRun({ ...finished }); setMarkStatuses(new Map(run.tasks.map((task) => [task.id, { status: 'open', sentTo: undefined }])), run.key); return; }
      openReview(agentReview(run, data.proposed, finished));
    },
  };

  /** Build the review for a finished run. Edits made here during the run are kept: the AI's changes are carried over to them. */
  function agentReview(run, proposed, finished) {
    const scoped = scopedReview(run.base, proposed, run.anchors);
    const common = { key: run.key, tasks: run.tasks, answers: finished.answers || new Map(), questions: finished.questions || new Map(), sourceLabel: run.agent.name, diskBaseline: finished.diskBaseline, origin: 'agent' };
    const now = activeDocumentRef.current.key === run.key ? getDocumentSource() : (fileContentsRef.current.get(run.key) ?? run.base);
    if (run.scope === 'folder' || now === run.base) return { ...common, base: run.base, ...scoped };
    const rebased = rebaseChanges(run.base, scoped.proposed, now);
    const fresh = new Map(buildTasks(now, markStore.get(run.key), { includeStatuses: REDLINE_STATUS }).map((task) => [task.id, task]));
    const tasks = run.tasks.map((task) => { const moved = fresh.get(task.id); return moved ? { ...moved, n: task.n } : task; });
    return { ...common, tasks, base: now, proposed: rebased.merged, unscoped: scoped.unscoped ? rebaseChanges(run.base, scoped.unscoped, now).merged : undefined,
      outside: scoped.outside, anchorMissing: scoped.anchorMissing, rebased: true, conflicts: rebased.conflicts };
  }

  useEffect(() => {
    const bridge = window.mengxDesktop?.agents;
    if (!bridge) return undefined;
    const events = () => agentEventsRef.current;
    const offOutput = bridge.onOutput((data) => events().output(data));
    const offStatus = bridge.onStatus?.((data) => events().status(data));
    const offProgress = bridge.onProgress?.((data) => events().progress(data));
    const offDone = bridge.onDone((data) => events().done(data));
    return () => { offOutput(); offDone(); offStatus?.(); offProgress?.(); };
  }, []);

  async function recoverAgentRun(id) {
    const run = await window.mengxDesktop.agents.recover(id);
    if (typeof run.proposed !== 'string') throw new Error(run.diagnostic?.message || '没有可恢复的结果，请查看任务日志');
    const handle = desktopHandle(run.record);
    await window.stetwiseReader.openFile({ file: await handle.getFile(), handle, path: handle.path });
    setAgentSettingsOpen(false);
    const parsed = parseReply(run.reply || run.output);
    openReview(agentReview({ key: activeDocumentRef.current.key, base: run.base, scope: run.scope, tasks: run.tasks || [], agent: { name: run.agentName },
      anchors: run.anchors?.length ? { enabled: true, anchors: run.anchors, wholeDocument: (run.tasks || []).some((task) => task.scope === 'document') } : null }, run.proposed,
      { answers: parsed.answers, questions: parsed.questions, diskBaseline: run.scope === 'folder' ? await (await handle.getFile()).text() : undefined }));
  }

  function stopAgent() {
    const run = agentRunRef.current;
    if (!run) return;
    if (['starting', 'running'].includes(run.status)) void window.mengxDesktop?.agents?.cancel(run.id);
    else { agentRunRef.current = null; setAgentRun(null); }
  }

  async function transferPackage() {
    const key = activeDocumentRef.current.key;
    if (manualTransfer?.key && manualTransfer.key !== key) throw new Error('请切回发起任务的文档');
    const { tasks, prompt, anchors } = promptFor('agent', 'file', manualTransfer?.onlyIds || null);
    const handle = fileHandlesRef.current.get(key);
    if (!handle?.desktop) throw new Error(language === 'zh' ? '请在桌面版打开已保存的 Markdown 文档' : 'Open a saved document in the desktop app');
    await flushAutomaticSave(); await writerRef.current.jobs.get(key);
    if (dirtyDocumentsRef.current.has(key)) throw new Error('请先成功保存文档，再生成任务包');
    const result = await window.mengxDesktop.handoff(handle.id, prompt, serializeSidecar(fileName, getAnnotations()), anchors?.enabled ? anchors.text : null);
    if (result?.anchored) setManualTransfer((current) => current && ({ ...current, anchors: { enabled: true, anchors: anchors.anchors, wholeDocument: anchors.wholeDocument }, base: getDocumentSource() }));
    markSent(tasks, { name: '任务文件夹' }, key); return result;
  }

  function importTransfer(text, full = false) {
    if (manualTransfer?.key && activeDocumentRef.current.key !== manualTransfer.key) throw new Error('请先切回发起任务的文档');
    const base = getDocumentSource(), anchors = manualTransfer?.anchors && manualTransfer.base === base ? manualTransfer.anchors : null;
    if (full) openReview({ key: activeDocumentRef.current.key, base, ...scopedReview(base, text, anchors), tasks: currentTasks(undefined, REDLINE_STATUS), answers: new Map(), sourceLabel: language === 'zh' ? '导入的文档' : 'Imported document', origin: 'reply' });
    else { const result = reviewReply(text); if (!result.ok) throw new Error(rt(language, 'pasteNothing')); }
    setManualTransfer(null); return { ok: true };
  }

  function openReview(next) {
    setMarkPopover(null); setCompareView(null); setPendingReview(null);
    if (!readingMode) commitInlineEdit({ notify: false });
    reviewRef.current = next;
    setReview(next);
    if (['agent', 'reply', 'external'].includes(next.origin)) void storePendingReview(next.key, serializeReview(next)).catch(() => {});
  }

  async function openExternalReview() {
    const key = activeDocumentRef.current.key, handle = fileHandlesRef.current.get(key);
    if (!handle) return;
    commitInlineEdit({ lock: false, notify: false });
    const disk = (await normalizeImportedFile(await handle.getFile())).content;
    setConflictDialog(false);
    openReview({ key, base: getDocumentSource(), proposed: disk, tasks: currentTasks(undefined, ['open', 'sent', 'unchanged']), answers: new Map(),
      sourceLabel: rt(language, 'externalSource'), diskBaseline: disk, origin: 'external' });
  }

  /** Replace the document with reviewed content. `diskBaseline` is what the file on disk holds now. */
  // "Insert as total row": find the table in the source and append a Markdown row.
  tableActionsRef.current = {
    insertTotal(table) {
      if (!table || !articleRef.current?.contains(table)) return;
      const label = language === 'zh' ? '合计' : 'Total';
      const body = table.tBodies[0]; if (!body) return;
      const selection = window.getSelection(), saved = selection.rangeCount ? selection.getRangeAt(0) : null;
      const range = document.createRange(); range.setStart(table.tHead || body, 0); range.setEnd(body, body.childNodes.length);
      selection.removeAllRanges(); selection.addRange(range);
      const captured = captureReadingSelection(articleRef.current, getDocumentSource(), documentAnalysis.chunks);
      selection.removeAllRanges(); if (saved) selection.addRange(saved);
      const source = getDocumentSource();
      const next = captured && appendTableRow(source, captured.anchor.sourceOffset, captured.anchor.sourceEnd, totalRowMarkdown(table, label));
      if (!next) { setNotice(language === 'zh' ? '没能在原文里找到这张表格' : 'Could not find this table in the source'); return; }
      applySource(next);
      setNotice(language === 'zh' ? '已插入合计行，可以撤销' : 'Total row inserted; you can undo it');
    },
  };

  function applySource(final, { diskBaseline } = {}) {
    const key = activeDocumentRef.current.key, handle = fileHandlesRef.current.get(key);
    if (diskBaseline !== undefined && handle && ['MD', 'TXT'].includes(activeDocumentRef.current.kind)) {
      writerRef.current.register(key, handle, diskBaseline);
      externalMetadataRef.current.delete(key);
    }
    getEditHistory().record(captureEditSnapshot());
    sourceBaseRef.current = final; draftHtmlRef.current = null; chunkDraftsRef.current.clear(); editorDraftRef.current = null;
    setMarkdown(final); fileContentsRef.current.set(key, final);
    setFileMeta((meta) => ({ ...meta, size: new Blob([final]).size }));
    lastEditSnapshotRef.current = captureEditSnapshot();
    resetRichEditor();
    if (diskBaseline !== undefined && final === diskBaseline) {
      documentRevisionRef.current += 1;
      dirtyDocumentsRef.current.delete(key); setDirtyMarkers(true); setSaveState({ status: 'saved' }); setHistoryVersion((value) => value + 1);
    } else markCurrentEdited();
  }

  async function applyReview(final, decisions, diff, { notes = {}, replies = {} } = {}) {
    const current = reviewRef.current;
    if (!current) return;
    if (activeDocumentRef.current.key !== current.key) await switchTab(current.key);
    if (current.origin === 'agent' && getDocumentSource() !== current.base && getDocumentSource() !== current.diskBaseline) { setNotice(language === 'zh' ? '文档在审阅期间又变了，没有覆盖当前内容。请放弃这次审阅后重新发送。' : 'The document changed during review. Discard this review and send again.'); return; }
    const previous = getDocumentSource(), statusesBefore = markSnapshot(current.key);
    if (current.origin === 'agent') { try { rememberRound(current.key, roundRecord(diff, decisions, current.tasks, notes)); } catch { /* the review is applied without the record */ } }
    applySource(final, { diskBaseline: current.diskBaseline });
    const touched = new Set();
    for (const hunk of diff.hunks) {
      if (hunk.type !== 'change' || decisions[hunk.id] === 'reject' || !hunk.base.length) continue;
      const start = diff.baseBlocks[hunk.base[0]].start, end = diff.baseBlocks[hunk.base.at(-1)].end;
      for (const task of current.tasks) if (task.blockStart >= start && task.blockStart < end) touched.add(task.id);
    }
    const marks = markStore.get(current.key);
    const updates = new Map();
    for (const task of current.tasks) {
      const mark = marks.find((item) => item.id === task.id);
      if (!mark) continue;
      const question = current.questions?.get(task.n);
      const reply = String(replies[task.n] || '').trim();
      if (question) { updates.set(task.id, { status: 'question', question, ...(reply ? { note: `${mark.note ? mark.note + '\n\n' : ''}${language === 'zh' ? '补充：' : 'Answer: '}${reply}` } : {}) }); continue; }
      if (task.type === 'ask') { const answer = current.answers?.get(task.n); updates.set(task.id, answer ? { status: 'answered', answer } : { status: 'open' }); continue; }
      if (task.scope === 'document') { updates.set(task.id, { status: diff.hunks.some((hunk) => hunk.type === 'change' && decisions[hunk.id] !== 'reject') ? 'resolved' : 'unchanged' }); continue; }
      const gone = resolveTextAnchor(final, mark.anchor).orphaned;
      updates.set(task.id, { status: touched.has(task.id) || gone ? 'resolved' : (current.origin === 'external' ? mark.status : 'unchanged') });
    }
    setMarkStatuses(updates);
    // A rejection with a note becomes a new instruction on the text that stayed.
    let offset = 0, created = 0;
    const createdIds = [], superseded = new Map();
    for (const hunk of diff.hunks) {
      const kept = hunk.type === 'equal' || decisions[hunk.id] === 'reject' ? hunk.base.map((index) => diff.baseBlocks[index].text).join('') : hunk.next.map((index) => diff.nextBlocks[index].text).join('');
      const note = hunk.type === 'change' && decisions[hunk.id] === 'reject' ? String(notes[hunk.id] || '').trim() : '';
      if (note && kept.trim()) {
        // Anchor the words, not the list marker, heading hashes or quote mark in front of them.
        const trimmed = kept.trim(), marker = /^(?:[-*+]|\d{1,9}[.)]|#{1,6}|>)[ \t]+/.exec(trimmed)?.[0] || '';
        const raw = trimmed.slice(marker.length), at = offset + (kept.length - kept.trimStart().length) + marker.length;
        const holder = document.createElement('div'); holder.innerHTML = safeMarkdown(raw, '', () => '');
        const anchor = { text: holder.textContent.trim() || raw, rawQuote: raw, sourceOffset: at, sourceEnd: at + raw.length, prefix: final.slice(Math.max(0, at - 48), at), suffix: final.slice(at + raw.length, at + raw.length + 48) };
        try {
          createdIds.push(addAnnotation('fix', { anchor, note, label: anchor.text }).id); created++;
          // The new instruction replaces the ones that produced the rejected change, so they are not sent again.
          for (const task of tasksForHunk(diff, hunk, current.tasks)) if (task.type !== 'ask' && updates.get(task.id)?.status !== 'question') superseded.set(task.id, { status: 'resolved' });
        } catch { /* the text could not be anchored */ }
      }
      offset += kept.length;
    }
    if (superseded.size) setMarkStatuses(superseded, current.key);
    const questionIds = [...updates.entries()].filter(([, value]) => value.status === 'question').map(([id]) => id);
    // Questions you answered and rejections you explained go back to the AI together.
    const followUpIds = [...questionIds, ...createdIds];
    showRound({ kind: 'review', origin: current.origin, key: current.key, previous, next: final, count: diff.hunks.filter((hunk) => hunk.type === 'change' && decisions[hunk.id] !== 'reject').length, at: Date.now(), statuses: statusesBefore, source: current.sourceLabel, followUpIds, created });
    reviewRef.current = null; setReview(null);
    window.clearTimeout(reviewProgressTimerRef.current); void storePendingReview(current.key, null).catch(() => {});
    if (agentRunRef.current?.key === current.key) { agentRunRef.current = null; setAgentRun(null); }
    if (fileHandlesRef.current.has(current.key) && ['MD', 'TXT'].includes(activeDocumentRef.current.kind)) {
      const saved = await saveCurrentFile();
      const asked = [...updates.values()].filter((item) => item.status === 'question').length;
      const answered = Object.values(replies).some((value) => String(value || '').trim());
      setNotice(saved?.ok ? (followUpIds.length && (answered || created) ? (language === 'zh' ? `已记下你的回答和意见。点上方「接着发给 AI」把这 ${followUpIds.length} 条再发一次。` : `Your answers and notes are saved. Choose Send to AI above to send these ${followUpIds.length} again.`) : asked ? rt(language, 'questionsPending', asked) : rt(language, 'reviewApplied')) : (language === 'zh' ? '审阅结果仍在本机草稿，写入失败：' : 'Reviewed result is still a draft; save failed: ') + (saved?.error || 'unknown'));
    } else setNotice(language === 'zh' ? '审阅完成；当前为会话文档，请导出保存' : 'Review complete; export this session document to save it');
  }

  async function discardReview() {
    const current = reviewRef.current;
    if (!current) return;
    if (activeDocumentRef.current.key !== current.key) await switchTab(current.key);
    // When the AI already changed the file on disk, put the reviewed-away version back.
    if (current.diskBaseline !== undefined && current.diskBaseline !== current.base) applySource(current.base, { diskBaseline: current.diskBaseline });
    setMarkStatuses(new Map((current.tasks || []).filter((task) => markStore.get(current.key).find((item) => item.id === task.id)?.status === 'sent').map((task) => [task.id, { status: 'open', sentTo: undefined }])));
    reviewRef.current = null; setReview(null);
    window.clearTimeout(reviewProgressTimerRef.current); void storePendingReview(current.key, null).catch(() => {});
    if (agentRunRef.current?.key === current.key) { agentRunRef.current = null; setAgentRun(null); }
    setNotice(rt(language, 'reviewDiscarded'));
  }

  // Automation and tests only: review a reply in Stetwise's <<<REVISION #n>>> format.
  function reviewReply(text, label = 'AI') {
    const source = getDocumentSource();
    const tasks = currentTasks(source, REDLINE_STATUS);
    const parsed = parseReply(text);
    let proposed = source, missing = [];
    if (parsed.patches.length) ({ source: proposed, missing } = applyPatches(source, tasks, parsed.patches));
    else if (!parsed.answers.size && !parsed.questions.size) {
      const full = extractFullDocument(text, source);
      if (!full) return { ok: false, error: 'nothing-to-apply' };
      proposed = full;
    }
    openReview({ key: activeDocumentRef.current.key, base: source, proposed, tasks, answers: parsed.answers, questions: parsed.questions, sourceLabel: label, origin: 'reply' });
    return { ok: true, missing };
  }

  async function goToAnnotation(id) {
    if (sourceView) await changeSourceView(false);
    const item = getAnnotations().find((entry) => entry.id === id);
    if (!item) throw new RangeError('Annotation not found');
    if (item.anchor.orphaned) return { ok: false, error: 'annotation-orphaned' };
    rememberNavigation(); restoringPositionRef.current = false;
    setActiveAnnotation(id); setRailMode(markRail(item.type)); setOutlineOpen(true);
    if (item.type === 'bookmark') {
      if (readingNavigationRef.current && typeof item.position === 'object') readingNavigationRef.current.restore({ ...item.position, sourceStart: documentAnalysis.chunks.find((chunk) => chunk.start <= item.anchor.sourceOffset && chunk.end > item.anchor.sourceOffset)?.start ?? item.position.sourceStart });
      else readingScrollRef.current?.scrollTo({ top: Number(item.position?.top ?? item.position) || 0, behavior: 'auto' });
    } else if (isLargeDocument) readingNavigationRef.current?.goToSource(item.anchor.sourceOffset);
    await waitForReader(() => {
      const range = findRenderedAnchor(articleRef.current, item.anchor, documentAnalysis.chunks);
      if (range) {
        readingNavigationRef.current?.cancel();
        const box = range.getBoundingClientRect(), viewport = readingScrollRef.current.getBoundingClientRect();
        if (item.type !== 'bookmark') readingScrollRef.current.scrollTop += box.top - viewport.top - Math.max(20, readingScrollRef.current.clientHeight / 3);
        return true;
      }
      return item.type === 'bookmark';
    }, { timeoutMs: 5000 });
    if (!usingRichEditor) paintedMarksRef.current = paintReadingHighlights(articleRef.current, getAnnotations(), getDocumentSource(), documentAnalysis.chunks, id);
    return { ok: true, id, sourceOffset: item.anchor.sourceOffset };
  }

  function moveSearchHit(direction) {
    if (!searchCount) return;
    if (searchOptions.scope !== 'document') { void selectSearchResult((searchIndex + direction + searchCount) % searchCount); return; }
    rememberNavigation();
    restoringPositionRef.current = false;
    setSearchIndex((current) => (current + direction + searchCount) % searchCount);
  }

  async function submitSearch() {
    try { searchExpression(searchDraft.trim(), searchOptionsDraft); }
    catch (error) { setSearchError(error.message); return { ok: false, error: error.code }; }
    rememberNavigation();
    restoringPositionRef.current = false;
    const nextQuery = searchDraft.trim();
    setSearchError(''); setSearchOptions({ ...searchOptionsDraft });
    setSearchQuery(nextQuery);
    setSearchIndex(0);
    setSearchNavigation((value) => value + 1);
    if (searchOptionsDraft.scope !== 'document') {
      const request = ++workspaceSearchRequestRef.current;
      setWorkspaceSearch({ pending: true, matches: [] });
      try {
        const result = await searchWorkspaceDocuments(nextQuery, searchOptionsDraft);
        if (request === workspaceSearchRequestRef.current) setWorkspaceSearch({ ...result, pending: false });
      } catch (error) { if (request === workspaceSearchRequestRef.current) { setSearchError(error.message); setWorkspaceSearch(null); } }
    }
    return { ok: true };
  }

  async function selectSearchResult(index) {
    if (searchOptions.scope !== 'document') {
      const hit = searchResults[index];
      if (!hit) return;
      const options = { ...searchOptions, scope: 'document' }, query = searchQuery;
      const file = searchableFiles.find((item) => item.path === hit.path && item.name === hit.name) || hit;
      rememberNavigation();
      const opened = await openRecentFile(file);
      if (opened?.ok === false) return opened;
      await awaitOpen(opened);
      await window.mengxReader.search(query, options);
      let same;
      for (let offset = 0; ; offset += 1000) {
        const page = window.mengxReader.getSearchResults({ offset, limit: 1000 });
        same = page.items.find((item) => Number.isFinite(hit.offset) && item.offset === hit.offset);
        if (same || offset + page.items.length >= page.total) break;
      }
      if (!same) {
        setNotice(language === 'zh' ? '此匹配位于 Markdown 源语法中，正文中没有对应文字' : 'This match belongs to source syntax and has no visible text');
        return { ok: false, error: 'match-not-rendered', sourceOffset: hit.offset };
      }
      return window.mengxReader.goToMatch(same.index);
    }
    rememberNavigation();
    restoringPositionRef.current = false;
    setSearchIndex(index);
    setSearchNavigation((value) => value + 1);
  }

  function closeSearch() {
    workspaceSearchRequestRef.current++;
    workspaceSearchCancelRef.current?.();
    workspaceSearchCancelRef.current = null;
    setWorkspaceSearch(null); setSearchError('');
    setSearchOpen(false);
    setSearchDraft('');
    setSearchQuery('');
    setSearchIndex(0);
  }

  function openSearch() {
    if (!searchOpen) {
      if (!readingMode) commitInlineEdit({ lock: false, notify: false });
      setSearchDraft(searchQuery);
      setSearchOpen(true);
      return;
    }
    closeSearch();
  }

  useEffect(() => {
    const recordError = (event) => {
      performanceRef.current.errors.push({ message: event.message || String(event.reason), at: Date.now() });
      performanceRef.current.errors = performanceRef.current.errors.slice(-30);
    };
    window.addEventListener('error', recordError);
    window.addEventListener('unhandledrejection', recordError);
    let observer;
    if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) performanceRef.current.longTasks.push({ durationMs: Math.round(entry.duration), startMs: Math.round(entry.startTime) });
        performanceRef.current.longTasks = performanceRef.current.longTasks.slice(-100);
      });
      observer.observe({ type: 'longtask' });
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener('error', recordError);
      window.removeEventListener('unhandledrejection', recordError);
    };
  }, []);

  async function awaitOpen(result) {
    await waitForReader((api) => {
      const state = api.getState();
      if (state.document.revision > result.revision) throw new DOMException('Document changed', 'AbortError');
      return state.document.revision === result.revision && state.document.ready;
    });
    return { ok: true, ...result };
  }

  async function apiOpenFile(input) {
    if (input instanceof File) return awaitOpen(await openFileObject(input));
    if (input?.file instanceof File) return awaitOpen(await openFileObject(input.file, input.handle, input.path));
    if (input?.getFile) return awaitOpen(await openFileObject(await input.getFile(), input, input.path || input.name));
    if (typeof input === 'string') {
      if (window.mengxDesktop && isNativePath(input)) return apiOpenFile(await openDesktopPath(input));
      if (isNativePath(input) || /^file:/i.test(input)) throw new TypeError('Use the CLI openPath command for absolute local paths');
      const response = await fetch(input);
      if (!response.ok) throw new Error(`Unable to open ${input}: ${response.status}`);
      const name = decodeURIComponent(new URL(input, location.href).pathname.split('/').pop()) || 'document.md';
      return awaitOpen(await openFileObject(new File([await response.blob()], name), null, input));
    }
    throw new TypeError('openFile expects a File, handle, URL or { file, path, handle }');
  }

  async function searchWorkspaceDocuments(query, options = {}) {
    const value = String(query ?? '').trim(), settings = normalizeSearchOptions(options);
    searchExpression(value, settings);
    if (!value) return { query: value, total: 0, matches: [], errors: [] };
    const worker = new Worker(new URL('./document.worker.js', import.meta.url), { type: 'module' });
    let cancelled = false;
    workspaceSearchCancelRef.current?.();
    const cancel = () => { cancelled = true; worker.terminate(); };
    workspaceSearchCancelRef.current = cancel;
    const matches = [], errors = []; let total = 0;
    const limit = Math.min(10000, options.limit || 1000);
    const request = (message, type) => new Promise((resolve, reject) => {
      if (cancelled) { reject(new DOMException('Search superseded', 'AbortError')); return; }
      const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Search timed out')); }, 10000);
      worker.onmessage = ({ data }) => {
        if (data.type === type) { clearTimeout(timeout); resolve(data); }
        if (['error', 'search-error'].includes(data.type)) { clearTimeout(timeout); reject(new Error(data.message)); }
      };
      worker.onerror = (event) => { clearTimeout(timeout); reject(new Error(event.message)); };
      worker.postMessage(message);
    });
    try {
      const candidates = directoryHandleRef.current?.desktop ? [...await allDesktopWorkspaceFiles(), ...recentFiles] : searchableFiles;
      const seen = new Set();
      const currentFolder = fileMeta.source.replace(/[\\/][^\\/]+$/, '').replaceAll('\\', '/').toLowerCase();
      for (const file of candidates) {
        const key = documentCacheKey(file.name, file.path);
        if (seen.has(key)) continue;
        seen.add(key);
        if (settings.scope === 'folder') {
          const fileFolder = (file.path || '').replace(/[\\/][^\\/]+$/, '').replaceAll('\\', '/').toLowerCase();
          if (fileFolder !== currentFolder) continue;
        }
        try {
          let source = key === activeDocumentRef.current.key ? getDocumentSource() : dirtyDocumentsRef.current.get(key);
          const handle = file.handle || fileHandlesRef.current.get(key) || await restoreFileHandle(key);
          if (source === undefined && handle) source = (await normalizeImportedFile(await handle.getFile())).content;
          if (source === undefined && file.file) source = (await normalizeImportedFile(file.file)).content;
          source ??= fileContentsRef.current.get(key) ?? fileContentsRef.current.get(normalizeResourceKey(file.name));
          if (source === undefined) continue;
          await request({ type: 'analyze', source }, 'model');
          const result = await request({ type: 'search', query: value, options: settings }, 'results');
          total += result.results.length;
          for (const hit of result.results) if (matches.length < limit) matches.push({ ...hit, documentIndex: hit.index, index: matches.length, path: file.path, name: file.name, handle: file.handle, file: file.file });
        } catch (error) { errors.push({ path: file.path, error: error.message }); }
      }
    } finally {
      worker.terminate();
      if (workspaceSearchCancelRef.current === cancel) workspaceSearchCancelRef.current = null;
    }
    if (cancelled) throw new DOMException('Search superseded', 'AbortError');
    return { query: value, total, matches, truncated: total > matches.length, errors };
  }

  useReaderApi({
    getState: getReaderState,
    getTabs,
    // Automation: the exact prompt a command-line agent receives, and review of a <<<REDLINE>>> reply.
    getAgentPrompt: (scope = 'file') => promptFor('agent', scope === 'folder' ? 'folder' : 'file').prompt,
    reviewReply: (text, label) => reviewReply(String(text || ''), label),
    openTab: async (input) => typeof input === 'string' || input instanceof File || input?.file || input?.getFile ? apiOpenFile(input) : awaitOpen(openTextDocument(input)),
    switchTab,
    closeTab,
    reopenClosedTab,
    goBack: () => navigateHistory('back'),
    goForward: () => navigateHistory('forward'),
    getAnnotations,
    undoAnnotation: () => changeAnnotationHistory('undo'),
    redoAnnotation: () => changeAnnotationHistory('redo'),
    addBookmark: (options) => addAnnotation('bookmark', options),
    addHighlight: (options) => addAnnotation('highlight', options),
    addUnderline: (options) => addAnnotation('underline', options),
    addNote: (options) => addAnnotation('note', options),
    removeAnnotation,
    updateAnnotation,
    goToAnnotation,
    exportAnnotations,
    getReadingPosition,
    restoreReadingPosition,
    getVersions: () => recoveryVersions(activeDocumentRef.current.key),
    restoreVersion,
    resolveConflict,
    checkExternalChanges,
    setHeadingCollapsed: (slug, collapsed = true) => {
      if (!outline.some((item) => item.slug === slug)) throw new RangeError('Heading not found');
      setCollapsedHeadings((current) => { const next = new Set(current); if (collapsed) next.add(slug); else next.delete(slug); return next; });
      return { ok: true, slug, collapsed };
    },
    waitForReady: (options) => waitForReader((api) => api.getState().document.ready && api.getState(), options),
    getContent: ({ start = 0, end } = {}) => {
      const source = getDocumentSource();
      return { name: fileName, revision: documentRevisionRef.current, length: source.length,
        content: source.slice(start, end) };
    },
    getOutline: (options) => pageOf(outline, options),
    getSearchResults: (options) => ({ query: searchQuery, pending: documentAnalysis.searching, ...pageOf(searchResults, options) }),
    getRecentFiles: () => recentFiles.map(({ name, path, type, size }) => ({ name, path, type, size,
      position: Number(loadReadingPositions()[documentCacheKey(name, path)]?.top ?? loadReadingPositions()[documentCacheKey(name, path)]) || 0 })),
    clearRecentHistory,
    removeRecent: (pathOrIndex) => removeRecentRecord(findRecentOrWorkspaceFile(pathOrIndex)),
    requestSourceDeletion: (pathOrIndex) => requestSourceDeletion(findRecentOrWorkspaceFile(pathOrIndex)),
    confirmSourceDeletion,
    cancelSourceDeletion,
    getWorkspace: () => ({ name: workspaceRootName, path: directoryHandleRef.current?.path, lazy: Boolean(directoryHandleRef.current?.desktop),
      folders: [...desktopFolders].flatMap(([, rows]) => rows.filter((row) => row.kind === 'folder').map(({ name, path }) => ({ name, path, expanded: expandedWorkspaceFolders.has(path) }))),
      files: workspaceFiles.map(({ name, path, relativePath, type, size }) => ({ name, path, relativePath, type, size })) }),
    openPath: async (path) => apiOpenFile(await openDesktopPath(path)),
    openFolderPath: async (path) => loadDirectory(await openDesktopPath(path)),
    openReferencePath: async (path) => {
      const handle = await openDesktopPath(path);
      return window.mengxReader.openReference({ file: await handle.getFile(), handle, path: handle.path });
    },
    expandDirectory: async (path) => {
      const row = [...desktopFolders.values()].flat().find((row) => row.kind === 'folder' && row.path === path);
      if (!row) throw new RangeError('Directory not found');
      if (!expandedWorkspaceFolders.has(path)) await toggleWorkspaceFolder(row);
      await yieldToBrowser();
      return { ok: true, path };
    },
    openText: (options) => awaitOpen(openTextDocument(options)),
    openFile: apiOpenFile,
    openRecent: async (pathOrIndex) => {
      const item = typeof pathOrIndex === 'number' ? recentFiles[pathOrIndex] : recentFiles.find((file) => file.path === pathOrIndex || documentCacheKey(file.name, file.path) === normalizeResourceKey(pathOrIndex));
      if (!item) throw new RangeError('Recent file not found');
      const result = await openRecentFile(item);
      return result?.ok === false ? result : awaitOpen(result);
    },
    openWorkspaceFile: async (path) => {
      const item = workspaceFiles.find((file) => file.path === path || file.relativePath === path);
      if (!item && directoryHandleRef.current?.desktop) return apiOpenFile(await openDesktopPath(`${directoryHandleRef.current.path}/${path}`));
      if (!item) throw new RangeError('Workspace file not found');
      const result = await openRecentFile(item);
      return result?.ok === false ? result : awaitOpen(result);
    },
    importWorkspace: (entries, options) => importWorkspace(entries, options),
    openDirectory: loadDirectory,
    searchWorkspace: searchWorkspaceDocuments,
    openReference,
    getReferenceOutline: (options) => pageOf(referenceAnalysis.outline, options),
    goToReferenceHeading: async (slugOrIndex) => {
      if (!splitView) throw new RangeError('Open a right-side document first');
      const item = typeof slugOrIndex === 'number' ? referenceAnalysis.outline[slugOrIndex] : referenceAnalysis.outline.find((entry) => entry.slug === slugOrIndex || entry.text === slugOrIndex || entry.slug.replace(/-\d+$/, '') === String(slugOrIndex).toLowerCase());
      if (referenceAnalysis.large && item) referenceNavigationRef.current?.goToSource(item.offset);
      await waitForReader(() => {
        const target = referenceArticleRef.current?.querySelector(`[data-heading="${CSS.escape(item?.slug || String(slugOrIndex))}"], [id="${CSS.escape(String(slugOrIndex))}"]`);
        if (!target) return false;
        referenceNavigationRef.current?.cancel(); target.scrollIntoView({ block: 'start' }); return true;
      }, { timeoutMs: 5000 });
      return { ok: true, ...(item || {}) };
    },
    openSplitTab: openReference,
    closeSplitTab: () => { closeSplit(); return { ok: true }; },
    swapSplit,
    setSplitSync: (value) => { setSplitSync(Boolean(value)); return { ok: true, sync: Boolean(value) }; },
    getSplitState: () => ({ open: splitView, sync: splitSync, left: { name: fileName, position: getReadingPosition() }, right: splitView ? { name: referenceName, path: referenceMeta?.path, position: getReferencePosition() } : null }),
    replaceContent: async (content, { expectedRevision } = {}) => {
      if (readingMode) throw Object.assign(new Error('Document is locked for reading'), { code: 'reading-locked' });
      if (expectedRevision !== undefined && expectedRevision !== documentRevisionRef.current) throw Object.assign(new Error('Document revision conflict'), { code: 'revision-conflict' });
      const source = String(content ?? '');
      getEditHistory().record(captureEditSnapshot());
      draftHtmlRef.current = null;
      chunkDraftsRef.current.clear();
      editorDraftRef.current = null; resetRichEditor();
      sourceBaseRef.current = source;
      setMarkdown(source);
      fileContentsRef.current.set(currentDocumentKey, source);
      dirtyDocumentsRef.current.set(currentDocumentKey, source);
      setFileMeta((meta) => ({ ...meta, size: new Blob([source]).size }));
      lastEditSnapshotRef.current = captureEditSnapshot();
      markCurrentEdited();
      return awaitOpen({ name: fileName, revision: documentRevisionRef.current });
    },
    undo: async () => { const result = undoEdit(); return result.ok ? awaitOpen({ name: fileName, revision: result.revision }) : result; },
    redo: async () => { const result = redoEdit(); return result.ok ? awaitOpen({ name: fileName, revision: result.revision }) : result; },
    search: async (query, options = {}) => {
      if (!readingMode) commitInlineEdit({ lock: false, notify: false });
      const value = String(query ?? '').trim();
      const settings = normalizeSearchOptions({ ...searchOptions, ...options });
      searchExpression(value, settings);
      setSearchError(''); setSearchOptions(settings); setSearchOptionsDraft(settings);
      if (value) restoringPositionRef.current = false;
      const revision = documentRevisionRef.current;
      setSearchDraft(value);
      setSearchQuery(value);
      setSearchIndex(0);
      setSearchNavigation((current) => current + 1);
      setSearchOpen(Boolean(value));
      if (settings.scope !== 'document') {
        const requestId = ++workspaceSearchRequestRef.current;
        setWorkspaceSearch({ pending: true, matches: [] });
        try {
          const result = await searchWorkspaceDocuments(value, settings);
          if (requestId === workspaceSearchRequestRef.current) setWorkspaceSearch({ ...result, pending: false });
          return { ...result, count: result.matches.length };
        } catch (error) {
          if (requestId === workspaceSearchRequestRef.current && error.name !== 'AbortError') setWorkspaceSearch({ pending: false, matches: [], errors: [{ error: error.message }] });
          throw error;
        }
      }
      return waitForReader((api) => {
        const state = api.getState();
        if (state.document.revision !== revision) throw new DOMException('Document changed', 'AbortError');
        if (state.document.searchQuery !== value || state.document.searching || !state.document.ready) return false;
        return { query: value, count: state.document.searchMatches, ...api.getSearchResults() };
      }, options);
    },
    goToMatch: async (index = 0) => {
      if (!Number.isInteger(index) || index < 0 || index >= searchCount) throw new RangeError('Match index out of range');
      if (searchOptions.scope !== 'document') return selectSearchResult(index);
      await selectSearchResult(index);
      setSearchOpen(true);
      await waitForReader(() => {
        const target = articleRef.current?.querySelector(`[data-search-index="${index}"]`);
        if (!target?.classList.contains('active-search-hit')) return false;
        const box = target.getBoundingClientRect(), region = readingScrollRef.current.getBoundingClientRect();
        return box.bottom >= region.top && box.top <= region.bottom;
      }, { timeoutMs: 5000 });
      const sourceOnly = articleRef.current?.querySelector(`[data-search-index="${index}"]`)?.dataset.sourceOnly === 'true';
      if (sourceOnly) setNotice(language === 'zh' ? '匹配位于链接地址或格式标记，已定位对应内容' : 'Source syntax match; located the surrounding content');
      return { ok: true, index, sourceOnly };
    },
    goToHeading: async (slugOrIndex) => {
      const item = typeof slugOrIndex === 'number' ? outline[slugOrIndex] : outline.find((entry) => entry.slug === slugOrIndex || entry.text === slugOrIndex || entry.slug.replace(/-\d+$/, '') === String(slugOrIndex).toLowerCase());
      if (!item) throw new RangeError('Heading not found');
      scrollToHeading(item);
      if (sourceView) {
        await waitForReader(() => Math.abs((readingNavigationRef.current?.getPosition()?.sourceOffset ?? -1000) - item.offset) < 300);
        return { ok: true, ...item };
      }
      await waitForReader(() => {
        const target = item === outline[0] && item.level === 1 ? document.querySelector('.document-heading h1')
          : articleRef.current?.querySelector(`[data-heading="${CSS.escape(item.slug)}"]`);
        if (!target) return false;
        const box = target.getBoundingClientRect(), region = readingScrollRef.current.getBoundingClientRect();
        return box.bottom >= region.top && box.top <= region.bottom;
      }, { timeoutMs: 5000 });
      return { ok: true, ...item };
    },
    closeSearch,
    setLanguage: (value) => { if (!['zh', 'en'].includes(value)) throw new RangeError('Invalid language'); setLanguage(value); return value; },
    setReadingMode: async (value) => {
      const next = Boolean(value);
      if (next) commitInlineEdit({ notify: false }); else setReadingMode(false);
      await waitForReader((api) => api.getState().ui.readingMode === next);
      return next;
    },
    setReadingWidth: (value) => { if (!['narrow', 'comfortable', 'wide'].includes(value)) throw new RangeError('Invalid reading width'); setReadingWidth(value); return value; },
    getReadingPreferences: () => ({ ...readingPreferences }),
    setReadingPreferences: (value = {}) => {
      const next = normalizeReadingPreferences({ ...readingPreferences, ...value });
      setReadingPreferences(next);
      return next;
    },
    resetReadingPreferences: () => { const next = { ...READING_PREFERENCE_DEFAULTS }; setReadingPreferences(next); return next; },
    setFocusMode: changeFocusMode,
    setSourceView: changeSourceView,
    setPanels: ({ sidebar, sidebarWidth: width, outline: showOutline, preferences, help, focus } = {}) => {
      if (typeof sidebar === 'boolean') setSidebarOpen(sidebar);
      if (Number.isFinite(width)) setSidebarWidth(Math.max(220, Math.min(480, width)));
      if (typeof showOutline === 'boolean') setOutlineOpen(showOutline);
      if (typeof preferences === 'boolean') setPreferencesOpen(preferences);
      if (typeof help === 'boolean') setHelpOpen(help);
      if (typeof focus === 'boolean') changeFocusMode(focus);
      return { ok: true };
    },
    toggleSplit: (value) => { const next = typeof value === 'boolean' ? value : !splitView; if (!next) closeSplit(); else setSplitView(true); return next; },
    scrollTo: (position) => {
      restoringPositionRef.current = false;
      if (readingNavigationRef.current) readingNavigationRef.current.scrollTo(position);
      else readingScrollRef.current?.scrollTo({ top: position === 'end' ? readingScrollRef.current.scrollHeight : Math.max(0, Number(position) || 0), behavior: 'auto' });
      return { ok: true };
    },
    showImage: (source) => { setLightbox(source ? { src: source, alt: '' } : null); return { ok: true }; },
    save: () => saveCurrentFile(),
    exportMarkdown: exportDraft,
    exportPdf, exportWord,
    cancelPdf,
    getPerformanceReport: () => ({ ...performanceRef.current,
      longTaskSupported: PerformanceObserver.supportedEntryTypes?.includes('longtask') || false,
      renderedChunks: document.querySelectorAll('.large-document-chunk').length,
      mountedNodes: document.getElementsByTagName('*').length,
      heapBytes: performance.memory?.usedJSHeapSize ?? null }),
    clearDiagnostics: () => { performanceRef.current = { opens: [], currentOpen: null, pdfJobs: [], longTasks: [], errors: [] }; return { ok: true }; },
  }, useMemo(() => getReaderState(), [tabs, tabVersion, restoringSession, navigationVersion, railMode, annotationVersion, activeAnnotation, closeTabConfirmation, language, fileName, fileMeta, dirty, saveState, historyVersion, deleteConfirmation, documentAnalysis.ready, documentAnalysis.progress,
    documentAnalysis.searching, documentAnalysis.wordCount, outline.length, searchQuery, searchCount, searchIndex, activeOutline, searchOptions, searchError, workspaceSearch, readingProgress, collapsedHeadings, recoveryAvailable, splitSync,
    sidebarOpen, sidebarWidth, outlineOpen, searchOpen, splitView, sourceView, readingMode, readingWidth, readingPreferences, focusMode, pdfProgress, markdown,
    workspaceRootName, workspaceFiles.length, referenceName, referenceAnalysis.ready, referenceMeta, preferencesOpen, helpOpen]));

  const annotations = getAnnotations();
  const redlineNumbers = numberRedlines(annotations);
  const openRedlines = annotations.filter((item) => isRedline(item.type) && ['open', 'sent', 'unchanged'].includes(item.status));
  // Same words twice on one line: say which one the instruction is about.
  const markOccurrences = new Map();
  for (const item of annotations.slice(0, 500)) {
    if (!isRedline(item.type) || item.anchor?.orphaned || item.anchor?.document || !(item.anchor?.sourceEnd > item.anchor?.sourceOffset)) continue;
    const hint = positionHint(markdown, item.anchor.sourceOffset, item.anchor.sourceEnd);
    if (hint?.total > 1) markOccurrences.set(item.id, { occurrence: hint.occurrence, total: hint.total });
  }
  const versionReason = (reason) => ({ zh: { 'before-ai': 'AI 修改前', autosave: '自动保存', 'before-save': '保存前', 'external-version': '外部版本', external: '被外部修改', 'before-external': '外部修改前' },
    en: { 'before-ai': 'before AI', autosave: 'autosave', 'before-save': 'before save', 'external-version': 'outside version', external: 'changed outside', 'before-external': 'before outside change' } }[language === 'en' ? 'en' : 'zh'][reason] || reason);
  const popoverMark = markPopover ? annotations.find((item) => item.id === markPopover.id) : null;
  const platform = window.mengxDesktop?.platform || 'web';
  const mod = platform === 'darwin' ? '⌘' : 'Ctrl';
  const annotationHistory = annotationHistoriesRef.current.get(currentDocumentKey);
  const zh = language === 'zh';

  return (
    <div spellCheck={false} className={`app-shell platform-${platform} ${focusMode ? 'focus-reading' : ''} ${sidebarOpen ? '' : 'sidebar-collapsed'} ${review ? 'reviewing' : ''}`} style={{ '--sidebar-width': `${sidebarWidth}px` }} onErrorCapture={handleResourceError} onLoadCapture={handleResourceLoad} onDragOver={(event) => { if (window.mengxDesktop && event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={async (event) => {
      if (!window.mengxDesktop || !event.dataTransfer.files.length) return;
      event.preventDefault();
      try {
        const handle = desktopHandle(await window.mengxDesktop.openDroppedFile(event.dataTransfer.files[0]));
        if (handle.kind === 'directory') await loadDirectory(handle);
        else await apiOpenFile(handle);
      } catch (error) { console.error(error); setNotice(copy.openAgain); }
    }}>
      <input ref={fileInputRef} className="visually-hidden" aria-hidden="true" tabIndex="-1" type="file" accept=".md,.markdown,.mdown,.mkd,.txt,.html,.htm,.docx,text/markdown,text/plain,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleFileChange} />
      <input ref={splitFileInputRef} className="visually-hidden" aria-hidden="true" tabIndex="-1" type="file" accept=".md,.markdown,.mdown,.mkd,.txt,.html,.htm,.docx,text/markdown,text/plain,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleReferenceChange} />
      <input ref={folderInputRef} className="visually-hidden" aria-hidden="true" tabIndex="-1" type="file" webkitdirectory="true" directory="true" multiple onChange={handleFolderChange} />

      <header className="topbar" onDoubleClick={(event) => {
        if (desktopWindow && platform !== 'darwin' && !event.target.closest('button, input, form, a, [role="tab"]')) void toggleWindowMaximize();
      }}>
        <div className="brand-block">
          <svg className="brand-mark" width="24" height="24" viewBox="0 0 26 26" aria-hidden="true"><rect width="26" height="26" fill="#FFFFFF" /><path d="M5 9h16M5 13h16M5 17h10" stroke="#0A0A0A" strokeWidth="2" /><path d="M3 21L23 5" stroke="#FF2D1A" strokeWidth="3.5" /></svg>
          <span className="brand-name">STETWISE</span>
        </div>
        <div className="document-tabs" role="tablist" aria-label={copy.markdownDocument}>
          <div className="reading-history-buttons"><button className="icon-button quiet" aria-label={zh ? '返回阅读位置' : 'Go back'} title="Alt ←" disabled={!navigationHistoryRef.current.back.length} onClick={() => void navigateHistory('back')}><ArrowLeft size={15} /></button><button className="icon-button quiet" aria-label={zh ? '前进阅读位置' : 'Go forward'} title="Alt →" disabled={!navigationHistoryRef.current.forward.length} onClick={() => void navigateHistory('forward')}><ArrowRight size={15} /></button></div>
          <div className="document-tab-list">{getTabs().map((tab) => {
            const count = tab.active ? openRedlines.length : 0;
            return <div className={`document-tab ${tab.active ? 'active' : ''}`} key={tab.id}>
              <button role="tab" aria-selected={tab.active} tabIndex={tab.active ? 0 : -1} title={tab.path} onClick={() => void switchTab(tab.id)}>{agentRun?.key === tab.id && ['starting', 'running'].includes(agentRun.status) && <span className="tab-running" title={zh ? 'AI 正在修改这篇文档' : 'AI is editing this document'} aria-label={zh ? 'AI 正在修改' : 'AI running'} />}<span className="tab-name">{tab.name}</span>{count > 0 && <span className="tab-count">{count}</span>}{tab.dirty && <span className="tab-dirty" title={zh ? '尚未写回原文件' : 'Unsaved changes'} />}</button>
              <button className="tab-close" title={`${zh ? '关闭' : 'Close'} · ${mod} W`} aria-label={`${zh ? '关闭' : 'Close'} ${tab.name}`} onClick={() => void closeTab(tab.id)}><X size={13} /></button>
            </div>;
          })}</div>
          <button className="tab-add icon-button quiet" onClick={openFilePicker} aria-label={copy.tabOpen} title={`${copy.tabOpen} · ${mod} O`}><Plus size={16} /></button>
        </div>
        <div className="topbar-actions">
          {tabs.length > 0 && <div className="mode-switch" role="group" aria-label={zh ? '阅读或编辑' : 'Read or edit'}>
            <button className={readingMode ? 'active' : ''} aria-pressed={readingMode} onClick={() => { if (!readingMode) toggleReadingMode(); }}><BookOpen size={14} />{copy.read}</button>
            <button className={!readingMode ? 'active' : ''} aria-pressed={!readingMode} onClick={() => { if (readingMode) toggleReadingMode(); }}><PencilLine size={14} />{zh ? '编辑' : 'Edit'}</button>
          </div>}
          {saveLabel && tabs.length > 0 && (['permission', 'error', 'conflict'].includes(saveState.status) ? <button className="autosave-state retry" onClick={() => saveState.status === 'conflict' ? setConflictDialog(true) : void saveCurrentFile()} title={copy.retrySave}>{saveLabel}</button> : <span className={`autosave-state ${saveState.status}`} role="status" title={saveState.status === 'session' ? copy.sessionSaveHint : saveLabel}>{saveState.status === 'saved' && <Check size={13} />}{saveLabel}</span>)}
          <button aria-label={copy.findInDocument} className={`icon-button ${searchOpen ? 'active' : ''}`} onClick={openSearch} title={`${copy.find} · ${mod} F`}><Search size={18} /></button>
          <div className="document-menu-anchor">
            <button className={`icon-button ${documentMenuOpen ? 'active' : ''}`} aria-label={copy.more} title={copy.more} aria-expanded={documentMenuOpen} onClick={() => setDocumentMenuOpen((value) => !value)}><MoreHorizontal size={18} /></button>
            {documentMenuOpen && <div className="document-menu" role="menu">
              <button role="menuitem" aria-label={splitView ? copy.single : copy.split} onClick={() => { setDocumentMenuOpen(false); splitView ? closeSplit() : void openReferencePicker(); }}><Split size={16} /><span>{splitView ? copy.single : copy.split}</span></button>
              <button role="menuitem" className="source-view-toggle" aria-label={sourceView ? (zh ? '返回排版视图' : 'Return to document') : (zh ? '查看 Markdown 源文件' : 'View Markdown source')} onClick={() => { setDocumentMenuOpen(false); void changeSourceView(!sourceView); }}><FileCode2 size={16} /><span>{sourceView ? (zh ? '返回排版' : 'Formatted view') : (zh ? 'Markdown 源文件' : 'Markdown source')}</span></button>
              <button role="menuitem" onClick={() => { setDocumentMenuOpen(false); setPathOpen(true); }}><FolderOpen size={16} /><span>{zh ? '按路径打开…' : 'Open by path…'}</span><kbd>{mod} L</kbd></button>
              <button role="menuitem" aria-label={zh ? '保存版本与恢复' : 'Saved versions and recovery'} onClick={() => { setDocumentMenuOpen(false); void showVersions(); }}><RefreshCw size={16} /><span>{zh ? '保存版本与恢复' : 'Saved versions and recovery'}</span></button>
              <span className="menu-separator" />
              <button role="menuitem" onClick={() => { setDocumentMenuOpen(false); setStatsOpen(true); }}><AlignLeft size={16} /><span>{zh ? '文档统计' : 'Document statistics'}</span></button>
              <button role="menuitem" aria-label={copy.export} onClick={() => { setDocumentMenuOpen(false); void exportDraft(); }}><Download size={16} /><span>{copy.export}</span></button>
              <button role="menuitem" aria-label={copy.exportPdf} disabled={Boolean(pdfProgress)} onClick={() => { setDocumentMenuOpen(false); setPdfOptions(readPdfOptions()); }}><FileDown size={16} /><span>{copy.exportPdf}…</span></button>
              <button role="menuitem" onClick={() => { setDocumentMenuOpen(false); void exportWord(); }}><FileDown size={16} /><span>{zh ? '导出 Word' : 'Export Word'}</span></button>
              <button role="menuitem" title={zh ? '把最近一次 AI 或外部修改写成 Word 修订，指令和 AI 的回答写成批注' : 'The latest AI or outside change as Word tracked changes, instructions as comments'} onClick={() => { setDocumentMenuOpen(false); void exportWord({ revisions: true }); }}><FileDown size={16} /><span>{zh ? '导出带修订的 Word' : 'Export Word with tracked changes'}</span></button>
              <button role="menuitem" onClick={() => { setDocumentMenuOpen(false); void exportChangeReport(); }}><FileDown size={16} /><span>{zh ? '导出修改记录' : 'Export change log'}</span></button>
              <button role="menuitem" onClick={() => { setDocumentMenuOpen(false); void copyRichText(); }}><Copy size={16} /><span>{zh ? '复制为富文本' : 'Copy as formatted text'}</span></button>
              <span className="menu-separator" />
              {window.mengxDesktop?.system && <button role="menuitem" onClick={() => { setDocumentMenuOpen(false); setSetupOpen(true); }}><Settings2 size={16} /><span>{zh ? '默认应用与 AI' : 'Default app and AI'}</span></button>}
              <button role="menuitem" onClick={() => { setDocumentMenuOpen(false); setAgentSettingsOpen(true); }}><Settings2 size={16} /><span>{rt(language, 'agentSettings')}</span></button>
              <div className="menu-history-actions"><button aria-label={copy.undo} disabled={readingMode || (!usingRichEditor && !canUndo)} onClick={() => undoEdit()}><Undo2 size={16} /><span>{copy.undo}</span></button><button aria-label={copy.redo} disabled={readingMode || (!usingRichEditor && !canRedo)} onClick={() => redoEdit()}><Redo2 size={16} /><span>{copy.redo}</span></button></div>
            </div>}
          </div>
          <span className="topbar-divider" />
          <div className="topbar-panel-anchor">
            <button className={`icon-button quiet ${preferencesOpen ? 'active' : ''}`} aria-label={copy.settings} title={copy.settings} onClick={() => { setPreferencesOpen((open) => !open); setHelpOpen(false); }}><Settings2 size={17} /></button>
            {preferencesOpen && <div className="topbar-popover preferences-popover" role="dialog" aria-label={copy.preferencePanel}>
              <div className="popover-heading"><strong>{copy.preferencePanel}</strong><button className="icon-button quiet" onClick={() => setPreferencesOpen(false)} aria-label={copy.closePanel} title={copy.closePanel}><X size={15} /></button></div>
              <div className="popover-section-label">{zh ? '界面语言 / Language' : 'Language / 界面语言'}</div>
              <div className="preference-segmented language-choice" role="group" aria-label={copy.language}>
                {[['en', 'English'], ['zh', '中文']].map(([value, label]) => <button key={value} className={language === value ? 'selected' : ''} onClick={() => setLanguage(value)} aria-pressed={language === value}>{label}</button>)}
              </div>
              <div className="popover-section-label">{zh ? '外观' : 'Appearance'}</div>
              <div className="preference-segmented" role="group" aria-label={zh ? '外观' : 'Appearance'}>
                {[['light', zh ? '浅色' : 'Light'], ['dark', zh ? '深色' : 'Dark'], ['system', zh ? '跟随系统' : 'System']].map(([value, label]) => <button key={value} className={theme === value ? 'selected' : ''} onClick={() => setTheme(value)} aria-pressed={theme === value}>{label}</button>)}
              </div>
              <div className="popover-section-label">{zh ? '正文底色' : 'Page colour'}</div>
              <div className="preference-segmented" role="group" aria-label={zh ? '正文底色' : 'Page colour'}>
                {[['white', zh ? '白色' : 'White'], ['sepia', zh ? '护眼米色' : 'Sepia']].map(([value, label]) => <button key={value} className={readingPreferences.background === value ? 'selected' : ''} onClick={() => updateReadingPreference('background', value)} aria-pressed={readingPreferences.background === value}>{label}</button>)}
              </div>
              <div className="popover-section-label">{copy.readerWidth}</div>
              <div className="preference-segmented" role="group" aria-label={copy.readerWidth}>
                {['narrow', 'comfortable', 'wide'].map((width) => <button key={width} className={readingWidth === width ? 'selected' : ''} onClick={() => setReadingWidth(width)} aria-pressed={readingWidth === width}>{copy[width]}</button>)}
              </div>
              <div className="popover-section-label">{copy.fontFamily}</div>
              <div className="preference-segmented" role="group" aria-label={copy.fontFamily}>
                {['sans', 'serif'].map((value) => <button key={value} className={readingPreferences.fontFamily === value ? 'selected' : ''} onClick={() => updateReadingPreference('fontFamily', value)} aria-pressed={readingPreferences.fontFamily === value}>{copy[value]}</button>)}
              </div>
              <div className="popover-section-label">{copy.fontSize}</div>
              <div className="preference-segmented" role="group" aria-label={copy.fontSize}>
                {['small', 'medium', 'large'].map((value) => <button key={value} className={readingPreferences.fontSize === value ? 'selected' : ''} onClick={() => updateReadingPreference('fontSize', value)} aria-pressed={readingPreferences.fontSize === value}>{copy[value]}</button>)}
              </div>
              <div className="popover-section-label">{copy.lineHeight}</div>
              <div className="preference-segmented" role="group" aria-label={copy.lineHeight}>
                {['tight', 'comfortable', 'relaxed'].map((value) => <button key={value} className={readingPreferences.lineHeight === value ? 'selected' : ''} onClick={() => updateReadingPreference('lineHeight', value)} aria-pressed={readingPreferences.lineHeight === value}>{copy[value]}</button>)}
              </div>
              <div className="popover-section-label">{copy.paragraphSpacing}</div>
              <div className="preference-segmented" role="group" aria-label={copy.paragraphSpacing}>
                {['compact', 'comfortable', 'airy'].map((value) => <button key={value} className={readingPreferences.paragraphSpacing === value ? 'selected' : ''} onClick={() => updateReadingPreference('paragraphSpacing', value)} aria-pressed={readingPreferences.paragraphSpacing === value}>{copy[value]}</button>)}
              </div>
              <div className="popover-section-label">{zh ? '代码字号' : 'Code size'}</div>
              <div className="preference-segmented" role="group" aria-label={zh ? '代码字号' : 'Code size'}>
                {['small', 'medium', 'large'].map((value) => <button key={value} className={readingPreferences.codeSize === value ? 'selected' : ''} onClick={() => updateReadingPreference('codeSize', value)} aria-pressed={readingPreferences.codeSize === value}>{copy[value]}</button>)}
              </div>
              <button className={`focus-preference-button ${focusMode ? 'selected' : ''}`} onClick={() => changeFocusMode(!focusMode)} aria-pressed={focusMode}><Maximize2 size={14} />{focusMode ? copy.exitFocusReading : copy.focusReading}<kbd>F9</kbd></button>
            </div>}
          </div>
          <div className="topbar-panel-anchor">
            <button className={`icon-button quiet ${helpOpen ? 'active' : ''}`} aria-label={copy.help} title={copy.help} onClick={() => { setHelpOpen((open) => !open); setPreferencesOpen(false); }}><CircleHelp size={17} /></button>
            {helpOpen && <div className="topbar-popover help-popover" role="dialog" aria-label={copy.helpTitle}>
              <div className="popover-heading"><strong>{copy.helpTitle}</strong><button className="icon-button quiet" onClick={() => setHelpOpen(false)} aria-label={copy.closePanel} title={copy.closePanel}><X size={15} /></button></div>
              <p>{zh ? '选中文字后，用「修改 / 删除 / 提问」给 AI 下指令，「修改」里写任何要求都行；「高亮 / 划线 / 批注」只给自己看。点任何标记都可以修改或移除。' : 'Select text and choose Fix, Delete or Ask to instruct the AI; a Fix can ask for anything. Highlight, Underline and Note stay private. Click any mark to change or remove it.'}</p>
              <div className="popover-section-label">{copy.shortcuts}</div>
              <div className="shortcut-list">
                <span><kbd>F D Q</kbd><span>{zh ? '选中后：修改 / 删除 / 提问（E：写好「展开」的修改）' : 'With a selection: Fix / Delete / Ask (E: a Fix that says "expand")'}</span></span>
                <span><kbd>H U N</kbd><span>{zh ? '选中后：高亮 / 划线 / 批注' : 'With a selection: Highlight / Underline / Note'}</span></span>
                <span><kbd>{mod} ↵</kbd><span>{rt(language, 'sendToAi')}</span></span>
                <span><kbd>{mod} P</kbd><span>{copy.findDocument}</span></span>
                <span><kbd>{mod} F</kbd><span>{copy.findInDocument}</span></span>
                <span><kbd>{mod} ⇧ F</kbd><span>{copy.workspace}</span></span>
                <span><kbd>{mod} S</kbd><span>{zh ? '保存' : 'Save'}</span></span>
                <span><kbd>F9</kbd><span>{copy.focusReading}</span></span>
              </div>
            </div>}
          </div>
          {desktopWindow && platform !== 'darwin' && <div className="window-controls" role="group" aria-label={zh ? '窗口控制' : 'Window controls'}>
            <button className="window-control" onClick={minimizeWindow} aria-label={zh ? '最小化' : 'Minimize'} title={zh ? '最小化' : 'Minimize'}><Minus size={15} /></button>
            <button className="window-control" onClick={() => void toggleWindowMaximize()} aria-label={windowMaximized ? (zh ? '还原' : 'Restore') : (zh ? '最大化' : 'Maximize')} title={windowMaximized ? (zh ? '还原' : 'Restore') : (zh ? '最大化' : 'Maximize')}>{windowMaximized ? <Copy size={14} /> : <Square size={14} />}</button>
            <button className="window-control window-control-close" onClick={closeWindow} aria-label={zh ? '关闭' : 'Close'} title={zh ? '关闭' : 'Close'}><X size={15} /></button>
          </div>}
        </div>
      </header>

      {pathOpen && <div className="address-popover" onMouseDown={(event) => { if (event.target === event.currentTarget) setPathOpen(false); }}><form className="address-bar" onSubmit={(event) => { event.preventDefault(); void openAddressPath(); setPathOpen(false); }}>
        <FolderOpen size={16} />
        <input autoFocus value={locationDraft} onChange={(event) => setLocationDraft(event.target.value)} onFocus={() => setLocationFocused(true)} onBlur={() => setLocationFocused(false)}
          role="combobox" aria-expanded={locationFocused && locationSuggestions.length > 0} aria-controls="path-suggestions" aria-autocomplete="list"
          aria-activedescendant={locationSuggestionIndex >= 0 ? `path-option-${locationSuggestionIndex}` : undefined}
          onKeyDown={(event) => {
            if (['ArrowDown', 'ArrowUp'].includes(event.key) && locationSuggestions.length) {
              event.preventDefault(); setLocationSuggestionIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + locationSuggestions.length) % locationSuggestions.length);
            } else if (event.key === 'Enter' && locationSuggestions[locationSuggestionIndex]) {
              event.preventDefault(); chooseLocationSuggestion(locationSuggestions[locationSuggestionIndex]);
            } else if (event.key === 'Escape') { event.preventDefault(); setLocationSuggestions([]); setPathOpen(false); }
          }} placeholder={copy.addressPlaceholder} aria-label={copy.addressPlaceholder} />
        {locationFocused && locationSuggestions.length > 0 && <div id="path-suggestions" className="path-suggestions" role="listbox">{locationSuggestions.map((item, index) => <button
          key={item.path} id={`path-option-${index}`} role="option" aria-selected={index === locationSuggestionIndex} className={index === locationSuggestionIndex ? 'selected' : ''}
          onMouseDown={(event) => event.preventDefault()} onClick={() => chooseLocationSuggestion(item)}>{item.kind === 'directory' ? <FolderOpen size={15} /> : <FileText size={15} />}<span>{item.path}</span></button>)}</div>}
      </form></div>}

      <div className="workspace-shell">
        <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
          <div className="side-tabs" role="tablist">
            <button role="tab" aria-selected={sideMode === 'contents'} className={sideMode === 'contents' ? 'active' : ''} onClick={() => { setSideMode('contents'); localStorage.setItem('redline-side-mode', 'contents'); }}>{rt(language, 'contents')}</button>
            <button role="tab" aria-selected={sideMode === 'files'} className={sideMode === 'files' ? 'active' : ''} onClick={() => { setSideMode('files'); localStorage.setItem('redline-side-mode', 'files'); }}>{rt(language, 'files')}</button>
            <button role="tab" aria-selected={sideMode === 'history'} className={sideMode === 'history' ? 'active' : ''} onClick={() => { setSideMode('history'); localStorage.setItem('redline-side-mode', 'history'); }}>{zh ? '历史' : 'History'}</button>
            <button className="icon-button quiet sidebar-toggle" onClick={() => setSidebarOpen(false)} aria-label={copy.collapseSidebar} title={copy.collapseSidebar}><PanelLeftClose size={16} /></button>
          </div>
          {sideMode === 'files' ? <div className="side-files">
            <div className="sidebar-toolbar">
              <button className="open-button" onClick={openFilePicker}><Plus size={16} /><span>{copy.open}</span><kbd>{mod} O</kbd></button>
              <button className="icon-button" onClick={openFolderPicker} aria-label={copy.chooseFolder} title={copy.chooseFolder}><FolderOpen size={17} /></button>
            </div>
            <div className="sidebar-search">
              <Search size={15} />
              <input ref={quickInputRef} value={quickQuery} onChange={(event) => setQuickQuery(event.target.value)} placeholder={copy.findDocument} />
              <kbd>{mod} P</kbd>
            </div>
            {(workspaceRootName || workspaceFiles.length > 0) && <div className="sidebar-section workspace-section">
              <div className="section-heading"><span title={directoryHandleRef.current?.path}>{workspaceRootName || copy.workspace}</span><div className="recent-heading-actions"><span className="section-meta">{workspaceFiles.length}</span>{directoryHandleRef.current?.desktop && <button className="icon-button" title={zh ? '刷新目录' : 'Refresh folder'} aria-label={zh ? '刷新目录' : 'Refresh folder'} onClick={() => void loadDirectory(directoryHandleRef.current)}><RefreshCw size={14} /></button>}</div></div>
              <div className="workspace-file-list">
                {workspaceTree.map((row) => row.kind === 'folder' ? <button className="workspace-folder" key={`folder:${row.path}`} style={{ paddingLeft: 10 + row.depth * 14 }} onClick={() => void toggleWorkspaceFolder(row)}>
                  {expandedWorkspaceFolders.has(row.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<FolderOpen size={15} /><span>{row.name}</span>
                </button> : <button className={`workspace-file ${row.file.name === fileName && row.file.path === fileMeta.source ? 'active' : ''}`} key={`${row.file.path}-${row.file.name}`} style={{ paddingLeft: 10 + row.depth * 14 }} onClick={() => openRecentFile(row.file)}>
                    <span className={`file-glyph ${row.file.type.toLowerCase()}`}><FileText size={15} /></span>
                    <span className="recent-copy"><strong>{row.file.name}</strong></span>
                  </button>)}
              </div>
            </div>}
            <div className="sidebar-section recent-section">
              <div className="section-heading"><span>{copy.recent}</span><div className="recent-heading-actions"><span className="section-meta">{filteredRecents.length}</span><button className="icon-button" onClick={clearRecentHistory} disabled={!recentFiles.length} aria-label={copy.clearRecents} title={copy.clearRecents}><Eraser size={15} /></button></div></div>
              <div className="recent-list">
                {filteredRecents.map((file) => (
                  <div className={`recent-entry ${file.active ? 'active' : ''}`} key={`${file.path}-${file.name}`}>
                    <button className="recent-item" onClick={() => openRecentFile(file)}>
                      <span className={`file-glyph ${file.type.toLowerCase()}`}><FileText size={15} /></span>
                      <span className="recent-copy"><strong>{file.name}</strong><small>{formatRecentPath(file.path, language)}</small></span>
                      <span className="recent-time">{formatRecentTime(file.time, language)}</span>
                    </button>
                    <button className="icon-button recent-menu-trigger" title={copy.recentActions} aria-label={`${copy.recentActions}: ${file.name}`} onClick={(event) => {
                      const box = event.currentTarget.getBoundingClientRect();
                      setRecentMenu({ file, left: Math.max(8, box.right - 232), top: Math.min(box.bottom + 4, window.innerHeight - 110) });
                    }}><MoreHorizontal size={15} /></button>
                  </div>
                ))}
                {!filteredRecents.length && <div className="empty-state">{copy.noMatches}</div>}
              </div>
            </div>
          </div> : sideMode === 'history' ? <HistoryPanel language={language} documentKey={currentDocumentKey} refresh={`${historyVersion}:${saveState.status}:${round?.at || 0}`} reasonLabel={versionReason}
            onCompare={(id) => void compareVersion(id).catch((error) => setNotice(error.message))} onRestore={(id) => void restoreVersion(id).catch((error) => setNotice(error.message))} /> : <div className="side-contents">
            <div className="outline-summary"><span>{outline.length} {zh ? '个章节' : 'sections'}</span></div>
            <VirtualList items={visibleOutline} className="outline-list" rowHeight={34} activeKey={activeOutline} focusKey={outlineFocus}
              itemKey={(item) => item.slug} renderItem={(item) => <div className={`outline-row level-${item.level} ${activeOutline === item.slug ? 'active' : ''}`}><button className="outline-fold" tabIndex={item.children ? 0 : -1} disabled={!item.children} aria-label={`${collapsedHeadings.has(item.slug) ? (zh ? '展开' : 'Expand') : (zh ? '收起' : 'Collapse')} ${item.text}`} aria-expanded={!collapsedHeadings.has(item.slug)} onClick={() => toggleHeading(item.slug)}>{item.children ? (collapsedHeadings.has(item.slug) ? <ChevronRight size={12} /> : <ChevronDown size={12} />) : <span />}</button><button className={`outline-item ${activeOutline === item.slug ? 'active' : ''}`} data-outline={item.slug} aria-current={activeOutline === item.slug ? 'location' : undefined} title={outlineBreadcrumb(item)} onKeyDown={(event) => handleOutlineKey(event, item)} onClick={() => scrollToHeading(item)}><span>{item.text}</span></button></div>} />
            <div className="reading-stats">
              <div className="reading-percent">{readingProgress}<span>%</span></div>
              <div className="reading-stats-label">{zh ? `已读 · 共 ${documentAnalysis.wordCount.toLocaleString()} 字` : `READ · ${documentAnalysis.wordCount.toLocaleString()} WORDS`}</div>
              <div className="outline-reading-actions"><button disabled={!lastReadPositionRef.current} onClick={() => void restoreReadingPosition()}>{zh ? '回到上次位置' : 'Resume'}</button><button onClick={() => window.mengxReader.scrollTo(0)}>{copy.backTop}</button></div>
            </div>
          </div>}
        </aside>
        {sidebarOpen && !focusMode && <div className="sidebar-resizer" role="separator" aria-label={zh ? '侧栏宽度' : 'Sidebar width'} aria-orientation="vertical" aria-valuemin={220} aria-valuemax={480} aria-valuenow={Math.round(sidebarWidth)} tabIndex={0}
          onPointerDown={resizeSidebar} onPointerMove={resizeSidebar} onPointerUp={resizeSidebar} onPointerCancel={resizeSidebar}
          onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setSidebarWidth((width) => Math.max(220, Math.min(480, width + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 50 : 10)))); } }} />}

        {!sidebarOpen && !review && !compareView && <button className="reopen-sidebar" onClick={() => setSidebarOpen(true)} aria-label={copy.showSidebar} title={copy.showSidebar}><LayoutPanelLeft size={17} /></button>}

        <main className="main-area" style={{ '--doc-align': documentAlign }}>
          {searchOpen && !review && <div className="search-strip">
            <Search size={16} />
            <input
              autoFocus
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (searchDraft.trim() !== searchQuery.trim() || JSON.stringify(searchOptionsDraft) !== JSON.stringify(searchOptions)) submitSearch();
                else moveSearchHit(event.shiftKey ? -1 : 1);
              }}
              placeholder={copy.searchPlaceholder}
            />
            <button className="search-submit" onClick={submitSearch} disabled={!searchDraft.trim()}>{copy.searchSubmit}</button>
            <div className="search-options">
              {['caseSensitive', 'wholeWord', 'regex'].map((key, index) => <button key={key} className={searchOptionsDraft[key] ? 'selected' : ''} aria-pressed={searchOptionsDraft[key]} title={zh ? ['区分大小写', '整词匹配', '正则表达式'][index] : ['Case sensitive', 'Whole word', 'Regular expression'][index]} aria-label={zh ? ['区分大小写', '整词匹配', '正则表达式'][index] : ['Case sensitive', 'Whole word', 'Regular expression'][index]} onClick={() => setSearchOptionsDraft((value) => ({ ...value, [key]: !value[key] }))}>{['Aa', 'Ab', '.*'][index]}</button>)}
              <select aria-label={zh ? '搜索范围' : 'Search scope'} value={searchOptionsDraft.scope} onChange={(event) => setSearchOptionsDraft((value) => ({ ...value, scope: event.target.value }))}>{['document', 'folder', 'workspace'].map((value, index) => <option key={value} value={value}>{zh ? ['当前文档', '当前文件夹', '全部工作区'][index] : ['Document', 'Current folder', 'All workspace'][index]}</option>)}</select>
            </div>
            <span className="search-result-count">
              {searchError || documentAnalysis.searchError || (workspaceSearch?.pending || documentAnalysis.searching ? copy.searchPreparing :
              searchDraft.trim() !== searchQuery.trim()
                ? (searchDraft.trim() ? copy.searchSubmitHint : copy.typeToSearch)
                : (searchQuery ? (searchCount ? `${searchIndex + 1} / ${searchCount} ${searchCount === 1 ? copy.match : copy.matches}` : `0 ${copy.matches}`) : copy.typeToSearch))}
            </span>
            <button className="icon-button quiet" onClick={() => moveSearchHit(-1)} disabled={!searchCount} aria-label={copy.searchPrevious} title={copy.searchPrevious}><ChevronUp size={15} /></button>
            <button className="icon-button quiet" onClick={() => moveSearchHit(1)} disabled={!searchCount} aria-label={copy.searchNext} title={copy.searchNext}><ChevronDown size={15} /></button>
            <button className="icon-button quiet" onClick={closeSearch} aria-label={copy.closeSearch} title={copy.closeSearch}><X size={16} /></button>
          </div>}

          <div className={`document-progress ${!documentAnalysis.ready || documentAnalysis.searching ? 'visible' : ''}`} role="progressbar" aria-label={documentAnalysis.searching ? copy.searchPreparing : copy.preparingDocument} aria-valuenow={documentAnalysis.progress} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${documentAnalysis.searching ? 55 : Math.max(3, documentAnalysis.progress)}%` }} />
          </div>

          {review ? <ReviewView key={`${review.key}:${review.origin}:${review.proposed.length}`} language={language} review={review} renderMarkdown={(source) => safeMarkdown(source, '', (path) => resolveDocumentAsset(path))} onApply={(final, decisions, diff, extras) => void applyReview(final, decisions, diff, extras)} onDiscard={() => void discardReview().catch((error) => setNotice(error.message))} onProgress={rememberReviewProgress} /> :
          compareView && compareView.key === currentDocumentKey ? <ReviewView key={`compare:${compareView.id}`} language={language} review={compareView} renderMarkdown={(source) => safeMarkdown(source, '', (path) => resolveDocumentAsset(path))} onRevert={revertFromCompare} onClose={() => setCompareView(null)}
            onExportWord={() => void exportWord({ revisions: true, base: compareView.base })} onExportReport={() => void exportChangeReport(compareView.base, compareView.proposed)} /> :
          <div className="reading-workspace">
          {!tabs.length ? <div className="reader-empty">
            <svg width="56" height="56" viewBox="0 0 26 26" aria-hidden="true"><rect width="26" height="26" fill="#0A0A0A" /><path d="M5 9h16M5 13h16M5 17h10" stroke="#FFFFFF" strokeWidth="2" /><path d="M3 21L23 5" stroke="#FF2D1A" strokeWidth="3.5" /></svg>
            <h2>{zh ? '读、批、改。' : 'Read. Mark. Revise.'}</h2>
            <p>{zh ? '打开一篇 AI 写的文档，标出要改的地方，一键交给 AI，再逐处审阅。' : 'Open a document, mark what should change, hand it to your AI, then review every edit.'}</p>
            <div className="reader-empty-actions"><button className="primary-button" onClick={openFilePicker}><FileText size={16} />{copy.open}</button><button onClick={openFolderPicker}><FolderOpen size={16} />{copy.chooseFolder}</button></div>
            {closedTabsRef.current.length > 0 && <button className="text-button" onClick={() => void reopenClosedTab()}>{zh ? '重新打开刚关闭的文档' : 'Reopen closed document'}</button>}
          </div> : <>
          <div className={`reading-stage ${searchQuery.trim() && searchDraft.trim() === searchQuery.trim() ? 'search-results-visible' : ''}`}>
            {searchOpen && searchQuery.trim() && searchDraft.trim() === searchQuery.trim() && <aside className="search-results-sidebar" aria-label={copy.searchResults}>
              <div className="search-results-heading"><span>{copy.searchResults}</span><strong>{searchCount}</strong></div>
              {searchResults.length ? <VirtualList items={searchResults} className="search-results-list" rowHeight={95} renderItem={(result) => (
                  <button key={result.index} className={`search-result-item ${result.index === searchIndex ? 'active' : ''}`} onClick={() => selectSearchResult(result.index)}>
                    <span className="search-result-number">{result.index + 1}</span>
                    <span className="search-result-copy"><small>{result.name || (zh ? result.location : { 标题: 'Heading', 表格: 'Table', 引用: 'Quote', 列表: 'List', 代码: 'Code', 正文: 'Text' }[result.location] || result.location)}{result.line !== undefined ? ` · ${result.line + 1}` : ''}</small><span>{result.snippet}</span></span>
                  </button>
                )} /> : <div className="search-results-empty">{searchError || documentAnalysis.searchError || (workspaceSearch?.pending || documentAnalysis.searching ? copy.searchPreparing : copy.searchNoMatches)}</div>}
              {workspaceSearch?.truncated && <div className="search-results-empty">{zh ? `共 ${workspaceSearch.total} 个匹配，显示前 ${searchCount} 个；缩小范围可查看更多。` : `${workspaceSearch.total} matches; showing ${searchCount}. Narrow the scope for more.`}</div>}
              {!!workspaceSearch?.errors?.length && <div className="search-results-empty">{zh ? `${workspaceSearch.errors.length} 个文件未能读取` : `${workspaceSearch.errors.length} files unavailable`}</div>}
            </aside>}

            <div className="reading-stage-main">
          <div className={`reading-layout width-${readingWidth} reader-font-${readingPreferences.fontFamily} reader-size-${readingPreferences.fontSize} reader-leading-${readingPreferences.lineHeight} reader-spacing-${readingPreferences.paragraphSpacing} reader-background-${readingPreferences.background} reader-code-${readingPreferences.codeSize} ${splitView ? 'split-enabled' : ''} ${usingRichEditor ? 'rich-editing' : ''}`}>
            <section className="reading-column reading-scroll-region" ref={readingScrollRef} aria-label={zh ? '正文阅读区' : 'Document reading pane'} tabIndex={0}>
              {terminalReview && <div className="round-bar terminal-review" role="status" aria-live="polite">
                <div className="round-text"><strong>{zh ? '终端里的 AI 在等你审这篇文档' : 'An AI in your terminal is waiting for your review'}</strong>
                  <small>{zh ? '标出要改的地方，再把指令发回去。它会直接改这个文件，改动显示在这里。' : 'Mark what should change, then send your instructions back. It edits this file, and its changes show here.'}</small></div>
                <div className="round-actions">
                  <button className="primary-button" onClick={() => void answerTerminalReview('notes')}>{zh ? '把指令发回终端' : 'Send instructions back'}</button>
                  <button onClick={() => void answerTerminalReview('none')}>{zh ? '不用改' : 'Nothing to change'}</button>
                </div>
              </div>}
              {saveState.status === 'conflict' && <div className="round-bar conflict" role="alert">
                <div className="round-text"><strong>{zh ? '被外部修改了' : 'Changed outside'}</strong><small>{zh ? '你这里也有没保存的修改，所以没有自动刷新' : 'You have unsaved changes here, so it did not refresh'}</small></div>
                <div className="round-actions"><button className="primary-button" onClick={() => void openExternalReview()}>{zh ? '对比并合并' : 'Compare and merge'}</button><button onClick={() => void resolveConflictFromUi('reload')}>{zh ? '用磁盘上的版本' : 'Use the version on disk'}</button><button onClick={() => setConflictDialog(true)}>{zh ? '更多…' : 'More…'}</button></div></div>}
              {round && round.key === currentDocumentKey && saveState.status !== 'conflict' && <div className={`round-bar ${round.undone ? 'undone' : ''}`} role="status" aria-live="polite">
                <div className="round-text">
                  <strong>{round.undone ? (zh ? '已撤销这次修改' : 'Change undone') : round.count ? `${roundLabel(round)} · ${zh ? `${round.count} 处` : `${round.count} change${round.count === 1 ? '' : 's'}`}` : roundLabel(round)}</strong>
                  {round.kind === 'external' && !round.undone && round.check && <span className={`round-check ${round.check.unasked ? 'warn' : ''}`}>{zh
                    ? `${round.check.asked} 处在你标记的段落里${round.check.unasked ? `，${round.check.unasked} 处没让改` : '，没有多改'}`
                    : `${round.check.asked} in paragraphs you marked${round.check.unasked ? `, ${round.check.unasked} not asked for` : ', nothing else changed'}`}</span>}
                  <small>{new Date(round.at).toLocaleTimeString()}{round.kind === 'external' && round.writes > 1 ? (zh ? ` · 共 ${round.writes} 次写入` : ` · ${round.writes} writes`) : ''}{round.created > 0 && !round.undone ? (zh ? ` · 已把 ${round.created} 条驳回意见变成新指令` : ` · ${round.created} rejection note${round.created === 1 ? '' : 's'} became instructions`) : ''}</small>
                </div>
                <div className="round-actions">
                  {!round.undone && round.followUpIds?.length > 0 && <button className="primary-button" onClick={() => openSendDialog(round.followUpIds)}>{zh ? `接着发给 AI（${round.followUpIds.length} 条）` : `Send ${round.followUpIds.length} to AI`}</button>}
                  {!round.undone && round.previous !== round.next && <button onClick={compareRound}>{zh ? '对比' : 'Compare'}</button>}
                  {round.previous === round.next ? null : round.undone ? <button onClick={redoRound}>{zh ? '恢复' : 'Redo'}</button> : <button onClick={undoRound} title={round.kind === 'external' ? (zh ? '把文件改回这次修改之前；外部程序如果还在写，可能会再改' : 'Put the file back; the other program may write again') : ''}>{zh ? '撤销' : 'Undo'}</button>}
                  <button className="quiet" aria-label={zh ? '关闭' : 'Dismiss'} onClick={() => showRound(null)}><X size={14} /></button>
                </div>
              </div>}
              {pendingReview && pendingReview.key === currentDocumentKey && !review && <div className="round-bar" role="status">
                <div className="round-text"><strong>{zh ? '有一次没审完的修改' : 'An unfinished review'}</strong><small>{pendingReview.sourceLabel} · {new Date(pendingReview.at).toLocaleString()}{pendingReview.progress?.decisions ? ` · ${zh ? '已决定' : 'decided'} ${Object.values(pendingReview.progress.decisions).filter(Boolean).length}` : ''}</small></div>
                <div className="round-actions"><button className="primary-button" onClick={() => { const value = reviveReview(pendingReview); setPendingReview(null); openReview(value); }}>{zh ? '继续审阅' : 'Continue'}</button>
                <button onClick={() => { void storePendingReview(pendingReview.key, null).catch(() => {}); setPendingReview(null); }}>{zh ? '放弃' : 'Discard'}</button></div></div>}
              {recoveryAvailable && <button className="recovery-banner" onClick={() => void showVersions()}>{zh ? '有尚未写回的恢复草稿，点击查看' : 'An unsaved recovery draft is available'}</button>}
              {documentAnalysis.degraded && <div className="recovery-banner degraded-banner" role="alert"><span>{zh ? '文档索引未能完成，当前为纯文本阅读；搜索和高级排版不可用。' : 'Indexing failed. Plain-text reading only; search and advanced layout are unavailable.'}</span><button onClick={documentAnalysis.retryPreparation}>{zh ? '重试' : 'Retry'}</button></div>}
              {!usingRichEditor && <header className="document-heading">
                <div className="document-eyebrow"><span>{formatKindLabel(fileMeta.kind, copy)}</span><span>·</span><span>{documentAnalysis.wordCount.toLocaleString()} {copy.words}</span><span>·</span><span>{formatBytes(fileMeta.size || 0)}</span></div>
                <h1>{documentTitle}</h1>
                <button className="document-path" onClick={() => setPathOpen(true)} title={`${fileMeta.source}
${copy.addressPlaceholder}`}>{shortPath(fileMeta.source)}</button>
              </header>}
              {usingRichEditor && richPart && richPart.count > 1 && <nav className="part-bar" aria-label={zh ? '分段编辑' : 'Editing part'}>
                <button onClick={() => switchRichPart(richPart.index - 1)} disabled={richPart.index === 0}><ArrowLeft size={14} />{zh ? '上一部分' : 'Previous'}</button>
                <select value={richPart.index} onChange={(event) => switchRichPart(Number(event.target.value))} aria-label={zh ? '选择要编辑的部分' : 'Choose part to edit'}>
                  {richPart.parts.map((part, index) => <option key={part.start} value={index}>{`${index + 1} / ${richPart.count} · ${part.label}`}</option>)}
                </select>
                <button onClick={() => switchRichPart(richPart.index + 1)} disabled={richPart.index >= richPart.count - 1}>{zh ? '下一部分' : 'Next'}<ArrowRight size={14} /></button>
              </nav>}
              {usingRichEditor ? (richPart ? <MarkdownEditor key={`${currentDocumentKey}:${editorKey}`} ref={editorRef} value={richPart.base.slice(richPart.start, richPart.end)} language={language} onChange={handleRichChange} resolveImage={(source) => resolveDocumentAsset(source)} onUpload={saveDocumentImage} onError={setNotice} /> : null) :
                (isLargeDocument || sourceView) && !documentAnalysis.ready ? <div className="large-document-loading"><p>{copy.preparingDocument} {documentAnalysis.progress}%</p></div> : (isLargeDocument || sourceView) ? <LargeDocumentView sourceMode={sourceView} key={`${currentDocumentKey}:${sourceView}`} markdown={markdown} model={documentAnalysis} query={activeSearchQuery} searchOptions={searchOptions} activeIndex={searchIndex} searchNavigation={searchNavigation} results={searchResults} headingTarget={headingTarget} articleRef={articleRef} scrollContainerRef={readingScrollRef} navigationRef={readingNavigationRef} onArticleClick={handleArticleClick} renderMarkdown={renderChunk} editable={!readingMode} drafts={chunkDraftsRef} onBeforeInput={handleBeforeInput} onInput={handleChunkInput} plainNote={copy.plainBlockNote} chartNote={copy.chartTooLargeNote} /> : <EditableMarkdown
                  key={currentDocumentKey}
                  elementRef={articleRef}
                  className={`document-content ${readingMode ? 'reading-locked' : 'content-editable'}`}
                  editable={!readingMode}
                  onBeforeInput={handleBeforeInput}
                  onInput={handleArticleInput}
                  onClick={handleArticleClick}
                  html={draftHtmlRef.current ?? renderedMarkdown}
                />}
            </section>

            {splitView && <section className="reference-column" style={{ '--doc-align': referenceAlign }} ref={referenceScrollRef} tabIndex={0} aria-label={zh ? '右侧阅读区' : 'Right reading pane'}>
              <div className="reference-header"><div><span className="reference-kicker">{copy.reference}</span><strong>{referenceName}</strong></div><button className={`icon-button quiet ${splitSync ? 'active' : ''}`} aria-label={zh ? '同步滚动' : 'Sync scrolling'} aria-pressed={splitSync} title={zh ? '同步滚动' : 'Sync scrolling'} onClick={() => setSplitSync((v) => !v)}><AlignLeft size={16} /></button><button className="icon-button quiet" aria-label={zh ? '交换左右文档' : 'Swap documents'} title={zh ? '交换左右文档' : 'Swap documents'} onClick={() => void swapSplit()}><Split size={16} /></button><button className="icon-button quiet" onClick={closeSplit} aria-label={copy.closeSplit} title={copy.closeSplit}><X size={16} /></button></div>
              {referenceAnalysis.large ? referenceAnalysis.ready && <LargeDocumentView key={`${referenceName}:${referenceMeta?.path}`} markdown={referenceMarkdown} model={referenceAnalysis} query="" activeIndex={0} results={[]} reference articleRef={referenceArticleRef} scrollContainerRef={referenceScrollRef} navigationRef={referenceNavigationRef} renderMarkdown={renderReferenceChunk} onArticleClick={handleReferenceClick} plainNote={copy.plainBlockNote} chartNote={copy.chartTooLargeNote} /> : <article ref={referenceArticleRef} className="reference-content document-content" onClick={handleReferenceClick} dangerouslySetInnerHTML={{ __html: renderedReference }} />}
              <button className="reference-switcher" onClick={openReferencePicker}><ChevronDown size={14} /> {copy.openReference}</button>
            </section>}
          </div>
            </div>
          </div>
          </>}
          </div>}
        </main>

        {outlineOpen && !focusMode && !review && !compareView && tabs.length > 0 && <InstructionRail language={language} mode={railMode} onMode={setRailMode} marks={annotations} numbers={redlineNumbers} occurrences={markOccurrences}
          activeId={markPopover?.id || activeAnnotation} busy={['starting', 'running'].includes(agentRun?.status)} storage={markStore.getSaveState(currentDocumentKey)} onStorage={() => setAgentSettingsOpen(true)}
          onSelect={(id) => {
            const whole = getAnnotations().find((entry) => entry.id === id);
            if (whole?.anchor?.document) { openMarkPopover(id, document.querySelector(`.rail-item[data-mark-id="${id}"]`)?.getBoundingClientRect(), { focus: true }); return; }
            void goToAnnotation(id).then(() => {
            const item = getAnnotations().find((entry) => entry.id === id);
            if (!item || item.type === 'bookmark' || usingRichEditor) return;
            const range = findRenderedAnchor(articleRef.current, item.anchor, documentAnalysis.chunks);
            if (range) openMarkPopover(id, range.getBoundingClientRect());
          }).catch(() => {}); }}
          onRemove={(id) => removeAnnotation(id)} onSend={(ids) => openSendDialog(Array.isArray(ids) ? ids : null)} onSendOptions={() => openSendDialog(null, { options: true })} onCopyTask={window.mengxDesktop ? () => void copyTaskForTerminal() : null}
          onClearDone={(ids) => { const previous = markStore.get(activeDocumentRef.current.key); markStore.set(activeDocumentRef.current.key, previous.filter((item) => !ids.includes(item.id))); recordAnnotationChange(previous); setAnnotationVersion((value) => value + 1); setUndoToast({ message: zh ? `已清理 ${ids.length} 条已处理的指令` : `Cleared ${ids.length} finished instruction${ids.length === 1 ? '' : 's'}`, at: Date.now() }); }}
          onDocumentInstruction={(rect) => { const created = addAnnotation('free', { anchor: { text: '', rawQuote: '', document: true, sourceOffset: 0, sourceEnd: 0 }, label: language === 'zh' ? '全文' : 'Whole document' }); openMarkPopover(created.id, rect, { focus: true }); }}
          onBookmark={() => addAnnotation('bookmark', {})} onExport={() => void exportAnnotations()}
          onUndo={() => changeAnnotationHistory('undo')} onRedo={() => changeAnnotationHistory('redo')} canUndo={Boolean(annotationHistory?.past.length)} canRedo={Boolean(annotationHistory?.future.length)}
          onHide={() => setOutlineOpen(false)} />}
        {!outlineOpen && !focusMode && !review && tabs.length > 0 && <button className="reopen-rail" onClick={() => setOutlineOpen(true)} aria-label={rt(language, 'redlines')} title={rt(language, 'redlines')}><PanelRight size={17} />{openRedlines.length > 0 && <span>{openRedlines.length}</span>}</button>}
      </div>

      {statsOpen && <StatsDialog language={language} stats={documentStats(getDocumentSource(), annotations, documentAnalysis.wordCount)} name={fileName} onClose={() => setStatsOpen(false)} />}
      {recentMenu && <div className="recent-menu" role="menu" style={{ left: recentMenu.left, top: recentMenu.top }}><button role="menuitem" onClick={() => removeRecentRecord(recentMenu.file)}><X size={15} />{copy.removeRecent}</button><button role="menuitem" className="danger" onClick={() => void requestSourceDeletion(recentMenu.file)}><Trash2 size={15} />{copy.deleteSource}</button></div>}
      {deleteConfirmation && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleteBusy) cancelSourceDeletion(); }}><div className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-warning"><h2 id="delete-title">{copy.deleteTitle}</h2><p className="delete-filename">{deleteConfirmation.file.name}</p><p className="delete-path">{deleteConfirmation.file.path}</p><p id="delete-warning">{window.mengxDesktop ? (zh ? (platform === 'darwin' ? '将把这个源文件移到废纸篓，需要时可以从废纸篓恢复。' : '将把这个源文件移入回收站，需要时可以从回收站还原。') : (platform === 'darwin' ? 'Move this file to the Trash. You can restore it from the Trash.' : 'Move this file to the Recycle Bin. You can restore it from the Recycle Bin.')) : copy.deleteWarning}</p><div className="dialog-actions"><button autoFocus disabled={deleteBusy} onClick={cancelSourceDeletion}>{copy.cancel}</button><button className="danger-button" disabled={deleteBusy} onClick={() => void confirmSourceDeletion(deleteConfirmation.token)}><Trash2 size={15} />{deleteBusy ? copy.deleting : copy.deleteSource}</button></div></div></div>}
      {selectionTools && !noteDialog && !selectionContextMenu && !markPopover && <div className="selection-tools" style={selectionTools} onMouseDown={(event) => event.preventDefault()}>
        {['fix', 'delete', 'ask'].map((type) => <button key={type} className={`sel-type type-${type}`} onClick={() => startAnnotation(type)} title={rt(language, `typeHint.${type}`)}><span className="mark-swatch" aria-hidden="true" />{typeLabel(language, type)}{readingMode && <kbd>{{ fix: 'F', delete: 'D', ask: 'Q' }[type]}</kbd>}</button>)}
        <span className="sel-divider" />
        <button className="sel-type type-highlight" onClick={() => startAnnotation('highlight')} title={rt(language, 'typeHint.highlight')}><Highlighter size={14} /></button>
        <button className="sel-type type-underline" onClick={() => startAnnotation('underline')} title={rt(language, 'typeHint.underline')}><Underline size={14} /></button>
        <button className="sel-type type-note" onClick={() => openSelectionNote(selectedPassageRef.current)} title={rt(language, 'typeHint.note')}><MessageCircle size={14} /></button>
        <button className="sel-close" aria-label={zh ? '关闭' : 'Close'} onClick={() => setSelectionTools(null)}><X size={14} /></button>
      </div>}
      {selectionContextMenu && !noteDialog && <div className="selection-context-menu" role="menu" style={{ left: selectionContextMenu.left, top: selectionContextMenu.top }} onMouseDown={(event) => event.preventDefault()}><button role="menuitem" onClick={() => void copySelectedText(selectionContextMenu.text)}><Copy size={15} />{zh ? '复制' : 'Copy'}</button><button role="menuitem" disabled={readingMode} onClick={() => void cutSelectedText(selectionContextMenu.text)}><Scissors size={15} />{zh ? '剪切' : 'Cut'}</button><span className="selection-context-divider" />{['fix', 'delete', 'ask'].map((type) => <button key={type} role="menuitem" className={`type-${type}`} disabled={!selectionContextMenu.anchor} onClick={() => startAnnotation(type, selectionContextMenu.anchor)}><span className="mark-swatch" aria-hidden="true" />{typeLabel(language, type)}</button>)}<span className="selection-context-divider" /><button role="menuitem" disabled={!selectionContextMenu.anchor} onClick={() => startAnnotation('highlight', selectionContextMenu.anchor)}><Highlighter size={15} />{typeLabel(language, 'highlight')}</button><button role="menuitem" disabled={!selectionContextMenu.anchor} onClick={() => startAnnotation('underline', selectionContextMenu.anchor)}><Underline size={15} />{typeLabel(language, 'underline')}</button><button role="menuitem" disabled={!selectionContextMenu.anchor} onClick={() => openSelectionNote(selectionContextMenu.anchor)}><MessageCircle size={15} />{typeLabel(language, 'note')}</button></div>}
      {changePopover && roundDiff && (() => {
        const hunk = roundDiff.diff.hunks.find((item) => item.id === changePopover.id);
        if (!hunk) return null;
        const before = hunk.base.map((index) => roundDiff.diff.baseBlocks[index].text).join(''), after = hunk.next.map((index) => roundDiff.diff.nextBlocks[index].text).join('');
        const related = round?.tasks?.length ? tasksForHunk(roundDiff.diff, hunk, round.tasks) : [];
        const chips = [...related.map((task) => ({ text: `#${task.n} ${typeLabel(language, task.type)}`, className: `mark-chip type-${task.type}` })),
          ...(round?.check && !related.length ? [{ text: rt(language, 'notAsked'), className: 'review-risk risk-unasked' }] : []),
          ...changeRisks(before, after).map((risk) => ({ text: rt(language, `risk.${risk.kind}`), className: `review-risk risk-${risk.kind}` }))];
        return <ChangePopover key={changePopover.id} language={language} before={before} after={after} anchorRect={changePopover.rect} chips={chips}
          onPutBack={() => putBackChange(changePopover.id)} onCompare={() => { setChangePopover(null); compareRound(); }} onClose={() => setChangePopover(null)} />;
      })()}
      {popoverMark && <MarkPopover key={popoverMark.id} mark={popoverMark} number={redlineNumbers.get(popoverMark.id)} anchorRect={markPopover.rect} language={language} autoFocus={markPopover.focus}
        onChangeType={(type) => updateAnnotation(popoverMark.id, { type })} onChangeNote={(note) => updateAnnotation(popoverMark.id, { note })}
        onRemove={() => removeAnnotation(popoverMark.id)} onClose={() => setMarkPopover(null)} onSend={() => openSendDialog([popoverMark.id])} />}
      {noteDialog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setNoteDialog(null); }}><div className="note-dialog annotation-dialog" role="dialog" aria-modal="true" aria-label={zh ? '编辑标注' : 'Edit mark'}><h2>{typeLabel(language, noteDialog.type)}</h2><blockquote>{noteDialog.anchor?.text}</blockquote><label className="annotation-field-label">{zh ? '名称' : 'Name'}<input autoFocus value={annotationLabelDraft} maxLength={160} onChange={(event) => setAnnotationLabelDraft(event.target.value)} /></label><div className="dialog-actions"><button onClick={() => setNoteDialog(null)}>{copy.cancel}</button><button className="primary-button" disabled={!annotationLabelDraft.trim()} onClick={() => { if (noteDialog.id) updateAnnotation(noteDialog.id, { label: annotationLabelDraft }); setNoteDialog(null); }}>{zh ? '保存' : 'Save'}</button></div></div></div>}
      {closeTabConfirmation && <div className="modal-backdrop"><div className="note-dialog" role="alertdialog" aria-modal="true"><h2>{zh ? '修改尚未写回原文件' : 'Changes have not been saved'}</h2><p>{closeTabConfirmation.name}</p><p>{zh ? '可以取消关闭并导出副本，或确认放弃这篇文档的修改。' : 'Cancel and export a copy, or discard changes and close.'}</p><div className="dialog-actions"><button autoFocus onClick={() => setCloseTabConfirmation(null)}>{copy.cancel}</button><button className="danger-button" onClick={() => void closeTab(closeTabConfirmation.id, { discard: true })}>{zh ? '放弃修改并关闭' : 'Discard and close'}</button></div></div></div>}
      {notice && <div className="toast"><Check size={15} />{notice}</div>}
      {actionToast && !undoToast && <div className="toast undo-toast action-toast" key={actionToast.at} role="status"><span>{actionToast.message}</span><button onClick={() => { actionToast.run(); setActionToast(null); }}>{actionToast.label}</button><button className="quiet" aria-label={zh ? '关闭' : 'Close'} onClick={() => setActionToast(null)}><X size={14} /></button></div>}
      {pdfOptions && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPdfOptions(null); }}><div className="note-dialog pdf-options" role="dialog" aria-modal="true" aria-labelledby="pdf-options-title" onKeyDown={(event) => { if (event.key === 'Escape') setPdfOptions(null); if (event.key === 'Enter') { const options = pdfOptions; setPdfOptions(null); void exportPdf(options); } }}>
        <h2 id="pdf-options-title">{zh ? '保存 PDF' : 'Save PDF'}</h2>
        <fieldset className="pdf-option"><legend>{zh ? '纸张' : 'Paper'}</legend><div className="segmented">{['A4', 'Letter'].map((paper) => <button key={paper} className={pdfOptions.paper === paper ? 'selected' : ''} aria-pressed={pdfOptions.paper === paper} onClick={() => setPdfOptions({ ...pdfOptions, paper })}>{paper}</button>)}</div></fieldset>
        <label className="pdf-option checkbox"><input type="checkbox" checked={pdfOptions.pageNumbers} onChange={(event) => setPdfOptions({ ...pdfOptions, pageNumbers: event.target.checked })} />{zh ? '页脚显示页码' : 'Page numbers in the footer'}</label>
        <p className="setup-muted">{zh ? '中文字体会嵌入 PDF；图表和流程图导出为矢量图。' : 'Chinese fonts are embedded; charts and diagrams stay vector.'}</p>
        <div className="dialog-actions"><button onClick={() => setPdfOptions(null)}>{copy.cancel}</button><button className="primary-button" autoFocus onClick={() => { const options = pdfOptions; setPdfOptions(null); void exportPdf(options); }}>{zh ? '保存' : 'Save'}</button></div>
      </div></div>}
      {undoToast && <div className="toast undo-toast" key={undoToast.at}><span>{undoToast.message}</span><button onClick={() => { changeAnnotationHistory('undo'); setUndoToast(null); }}>{rt(language, 'undo')}<kbd>{mod} Z</kbd></button></div>}
      {pdfProgress && <div className="progress-toast" role="status" aria-live="polite"><div className="progress-toast-line"><span>{pdfProgress.label}</span><strong>{pdfProgress.value}%</strong><button className="icon-button" onClick={cancelPdf} aria-label={copy.cancel} title={copy.cancel}><X size={14} /></button></div><div className="progress-track"><span style={{ width: `${pdfProgress.value}%` }} /></div>{pdfProgress.pages > 0 && <small>{pdfProgress.pages.toLocaleString()} {copy.pages}</small>}</div>}
      {versionDialog && <div className="modal-backdrop"><div className="note-dialog versions-dialog" role="dialog" aria-modal="true" aria-label={zh ? '保存版本与恢复' : 'Saved versions and recovery'}><div className="popover-heading"><strong>{zh ? '保存版本与恢复' : 'Saved versions and recovery'}</strong><button className="icon-button quiet" aria-label={copy.cancel} onClick={() => setVersionDialog(null)}><X size={16} /></button></div><p>{fileName}</p>{versionDialog.draft && <button className="version-entry" onClick={() => setVersionToRestore('draft')}><span>{zh ? '未写回的恢复草稿' : 'Unsaved recovery draft'}</span><small>{new Date(versionDialog.draft.at).toLocaleString()} · {versionDialog.draft.length.toLocaleString()}</small></button>}{versionDialog.versions.map((version) => <div className="version-row" key={version.id}><button className="version-entry" onClick={() => setVersionToRestore(version.id)}><span>{new Date(version.at).toLocaleString()}</span><small>{version.length.toLocaleString()} · {versionReason(version.reason)}</small></button><button className="version-compare" onClick={() => void compareVersion(version.id).catch((error) => setNotice(error.message))}>{zh ? '对比' : 'Compare'}</button></div>)}{!versionDialog.draft && !versionDialog.versions.length && <p>{zh ? '当前文档还没有保存版本' : 'No saved versions yet'}</p>}{versionToRestore && <div className="version-confirm"><p>{zh ? '恢复此版本并自动保存？恢复后页面顶部会出现「撤销」，随时可以改回来。' : 'Restore and autosave this version? An Undo button appears at the top afterwards.'}</p><div className="dialog-actions"><button onClick={() => setVersionToRestore(null)}>{copy.cancel}</button><button className="primary-button" onClick={() => void restoreVersion(versionToRestore).catch((error) => setNotice(error.message))}>{zh ? '确认恢复' : 'Restore'}</button></div></div>}</div></div>}
      {conflictDialog && <div className="modal-backdrop"><div className="note-dialog conflict-dialog" role="alertdialog" aria-modal="true" aria-labelledby="conflict-title">
        <h2 id="conflict-title">{zh ? '被外部修改了' : 'Changed outside Stetwise'}</h2>
        <p className="conflict-path">{fileMeta.source}</p>
        <p>{zh ? '你这里也有没保存的修改，所以写回已暂停。可以对比两边，逐处决定保留哪一边。' : 'You also have unsaved changes here, so saving is paused. Compare both sides and decide what to keep.'}</p>
        <div className="conflict-actions">
          <button className="primary-button" autoFocus disabled={conflictBusy} onClick={() => void openExternalReview()}>{zh ? '对比并合并' : 'Compare and merge'}</button>
          <button disabled={conflictBusy} onClick={() => void resolveConflictFromUi('reload')}><RefreshCw size={15} />{zh ? '直接加载磁盘版本' : 'Load disk version'}</button>
          <button disabled={conflictBusy} onClick={() => void exportDraft()}><FileDown size={15} />{zh ? '导出当前副本' : 'Export current copy'}</button>
          <button className="danger-button" disabled={conflictBusy} onClick={() => void resolveConflictFromUi('overwrite')}>{zh ? '备份并覆盖原文件' : 'Back up and overwrite'}</button>
          <button disabled={conflictBusy} onClick={() => setConflictDialog(false)}>{zh ? '稍后处理' : 'Later'}</button>
        </div>
      </div></div>}
      {paletteOpen && <CommandPalette language={language} onClose={() => setPaletteOpen(false)} commands={paletteCommands()} />}
      {sendOpen && <SendDialog language={language} onSaveAs={window.mengxDesktop && !canRunLocalAgent() ? () => void saveAsMarkdownAndSend() : null} taskCount={tasksToSend(sendOpen?.onlyIds).length} quick={Boolean(sendOpen?.quick)} mixedScope={((tasks) => tasks.some((task) => task.scope === 'document') && tasks.some((task) => task.scope !== 'document'))(tasksToSend(sendOpen?.onlyIds))} canRunLocal={canRunLocalAgent()} hidden={hiddenContent(getDocumentSource())} onClose={() => setSendOpen(false)} onStart={(options) => void startAgent(options)} onSettings={() => { setSendOpen(false); setAgentSettingsOpen(true); }} />}
      {setupOpen && <SetupWizard language={language} platform={platform} onClose={closeSetup} />}
      {manualTransfer && <ManualTransfer language={language} onClose={() => setManualTransfer(null)} onPackage={() => transferPackage()} onImport={(text) => importTransfer(text, true)} />}
      {agentSettingsOpen && <AgentSettings language={language} onClose={() => setAgentSettingsOpen(false)} onNotice={setNotice} onRecover={recoverAgentRun} />}
      {agentRun && !review && !compareView && <RunPanel language={language} run={agentRun} onStop={stopAgent} onLogin={agentRun.agent?.kind === 'cli' ? () => void window.mengxDesktop.agents.login(agentRun.agent.id, readAgentSettings().overrides).then(() => setNotice(language === 'zh' ? '已打开登录终端。登录完成后点「重新发送」。' : 'Sign-in terminal opened. Send again when done.')).catch((error) => setNotice(error.message)) : null} onPreview={() => { const run = agentRunRef.current; if (run?.live && run.key === activeDocumentRef.current.key) openCompare({ base: run.base, proposed: stripAnchors(run.live), label: run.agent.name, readOnly: true }); }} onDismiss={() => { agentRunRef.current = null; setAgentRun(null); }} onSettings={() => setAgentSettingsOpen(true)} onDiagnose={() => void window.mengxDesktop.agents.diagnostics({ overrides: readAgentSettings().overrides, runId: agentRun.id }).then((result) => setNotice('诊断任务已保存：' + result.path)).catch((error) => setNotice(error.message))}
        onRetry={() => void (async () => { const run = agentRunRef.current; if (!run) return; if (activeDocumentRef.current.key !== run.key) await switchTab(run.key); agentRunRef.current = null; setAgentRun(null); /* after a failed run the dialog opens, so another AI can be chosen */ openSendDialog(run.tasks.map((task) => task.id), { options: true }); })().catch((error) => setNotice(error.message))}
        onReview={() => { const run = agentRunRef.current; if (run && typeof run.proposed === 'string') openReview({ key: run.key, base: run.base, ...scopedReview(run.base, run.proposed, run.anchors), tasks: run.tasks, answers: run.answers || new Map(), sourceLabel: run.agent.name, diskBaseline: run.diskBaseline, origin: 'agent' }); }} />}
      {lightbox && <ImageViewer key={lightbox.key || lightbox.src} image={lightbox} language={language} onClose={() => setLightbox(null)} onNotice={setNotice} />}
    </div>
  );
}


void restoreAgentSettings().catch((error) => console.error('AI settings storage:', error)).finally(() => createRoot(document.getElementById('root')).render(<App />));
