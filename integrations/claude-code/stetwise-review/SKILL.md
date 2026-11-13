---
name: stetwise-review
description: Ask the user to review a Markdown document in Stetwise and get their instructions back. Use after writing or revising a plan, spec, report or other long Markdown file the user should check, or when the user says they want to review or mark up a document.
---

# Review a document in Stetwise

Stetwise is a desktop app where the user reads a Markdown file, marks the passages that should
change, and writes a short instruction on each. `stetwise-review` hands a file to that app and
waits for the user's instructions.

## How to ask for a review

Run the command with the file to review and wait for it to finish. It can take as long as the
user needs to read the document, so do not put a short timeout on it.

```sh
stetwise-review path/to/document.md
```

If `stetwise-review` is not on the PATH, use the full path of the launcher that is installed
next to the app. The user can copy it from Stetwise: press Ctrl K (Cmd K on a Mac) and choose
"Copy the review command for my terminal AI".

- Windows: `"%LOCALAPPDATA%\Programs\Stetwise\stetwise-review.cmd" path\to\document.md`
- macOS: `/Applications/Stetwise.app/Contents/Resources/stetwise-review path/to/document.md`

## What comes back

The command prints the user's instructions and exits with 0. Each instruction names the line,
the marked text, the text just before and after it, and what the user wants there.

- Carry the instructions out by editing that file directly. Change only what they ask for:
  Stetwise shows the user every change next to the instruction it belongs to, and points out
  changes nobody asked for.
- If the output says no changes were asked for, leave the file as it is and continue.
- Exit code 3: the user closed Stetwise without answering. Ask whether to try again.
- Exit code 2: nobody answered in time (`--timeout <minutes>`, 60 by default). The file is
  still open in Stetwise; run the command again to keep waiting.

When an instruction is unclear, or asks for facts the document does not contain, ask the user
instead of guessing.
