// The welcome document shown on first start when the interface is in English, and which
// sample (name, place, text) the app opens with for each interface language.
import { DEMO_DOCUMENT, INITIAL_RECENTS } from './demo';

export const DEMO_DOCUMENT_EN = `# Welcome to Stetwise

> Read what your AI wrote, mark what should change, and see every word it changes.

## Three steps

1. **Select text and say what you want.** Select any passage and choose Fix, Delete or Ask, or press F, D or Q. Write the instruction in a sentence.
2. **Hand it to your AI.** Click **Copy as a task for my terminal AI** and paste it into Claude Code, Codex or whichever AI you have running. Or click **Send to AI** and Stetwise starts one of the command-line AIs on this computer for you.
3. **Check each change.** Every change is listed on its own, word by word. Keep it or put it back. When Stetwise ran the AI, nothing is written to your file until you finish.

## Your CLI is not listed?

If the AI you use does not appear under **Send to AI**, let it find itself. Open the terminal where you normally talk to it and send it this:

~~~text
I want to call you from Stetwise (a local Markdown review app) without prompts, to edit documents. Check this on my computer by running each step for real, do not guess:
1. Find the full absolute path of the executable or launcher script I start you with (Windows: where / Get-Command; macOS: which; for a .cmd, .ps1, script or alias, find the real entry point).
2. Run --version with that full path and tell me the output.
3. Run once without prompts using the full path, replying only READY. Tell me the exact command and its output.
4. In a temporary folder create test.md containing "The cost is 10." Without prompts, change 10 to 20; you must not stop to ask me. Read the file afterwards to confirm it says 20.
5. Write the command that worked in step 4 as a one-line template: {prompt} for the instruction, {file} for the document path, {dir} for the working folder.
Give me only two things: the full path of the executable, and the command template. Do not change your sign-in, model or proxy settings, and do not show any key or token.
~~~

Then open **More → AI tools**. If the tool is in the list, put the path in its Path field and click Test connection. If it is not, click Add custom command and paste the template.

## Two kinds of marks

| Kind | For | Sent to the AI? |
| --- | --- | --- |
| Fix, Delete, Ask | Instructions for the AI | Yes |
| Highlight, Underline, Note | Your own reading marks | No |

Click any mark in the text to change its kind, edit the instruction or remove it; removing can be undone. Without selecting anything, **Whole-document instruction** on the right gives one instruction for the entire document.

When Stetwise runs the AI, it changes only the characters you selected: select the second 6 in "36361" and only that 6 changes. Anything it changes elsewhere is set aside and listed for you. When an AI in your terminal edits the file, Stetwise tells you which changes are in paragraphs you marked and which are not.

## Charts and tables

A chart's data is an ordinary table with one hidden line above it. In other apps it stays a table; here it is drawn as a chart. **Data** shows the table, and **Instruct on chart** lets the AI change the figures.

<!-- stetwise:chart type=bar title="Sales by quarter" unit="k" -->
| Quarter | Online | Stores |
|---|---:|---:|
| Q1 | 80 | 40 |
| Q2 | 95 | 55 |
| Q3 | 120 | 60 |
| Q4 | 110 | 72 |

Click a table header to sort; numeric columns show a total and an average underneath. While editing, type / to insert a bar chart, a pie chart, a table with totals and more.

## Editing

**Edit** at the top right opens a what-you-see editor. You do not need to know Markdown: headings, lists, tables and formulas come from the toolbar or from typing /. Paragraphs you do not touch keep their formatting exactly.

A formula such as $E = mc^2$ is drawn as it should be.

~~~js
// Code blocks are highlighted too
const review = await stetwise.send({ agent: 'claude-code', scope: 'file' });
~~~

---

The interface language (English / 中文) is under Settings, at the top right.
`;

const SAMPLES = {
  zh: { name: '欢迎使用 Stetwise.md', path: 'Stetwise / 示例', document: DEMO_DOCUMENT, recents: INITIAL_RECENTS },
  en: { name: 'Welcome to Stetwise.md', path: 'Stetwise / Samples', document: DEMO_DOCUMENT_EN,
    recents: [{ name: 'Welcome to Stetwise.md', path: 'Stetwise / Samples', type: 'MD', time: 'just-now', active: true }] },
};

/**
 * The interface language at start: the one the user chose before, else the one asked for in
 * the address (?lang=zh, used by tests and by --language), else English.
 */
export function startLanguage() {
  try {
    const saved = window.localStorage.getItem('morrow-language');
    if (saved === 'zh' || saved === 'en') return saved;
    const asked = new URLSearchParams(window.location.search).get('lang');
    if (asked === 'zh' || asked === 'en') return asked;
  } catch { /* storage or address unavailable */ }
  return 'en';
}

export const startSample = () => SAMPLES[startLanguage()];
