#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeDocument, searchDocument } from '../src/document-model.js';
import { runSession } from './reader-session.mjs';

const [, , command, fileArg, ...rest] = process.argv;
const usage = 'Usage: reader <analyze|outline|search|check> <file> [query], or reader session [--desktop] [--visible] [--output <directory>]';

if (command === 'session') {
  try { await runSession(process.argv.slice(3)); } catch (error) { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; }
} else if (!command || !fileArg || !['analyze', 'outline', 'search', 'check'].includes(command)) {
  console.error(usage);
  process.exitCode = 2;
} else {
  try {
    const file = path.resolve(fileArg);
    const bytes = await readFile(file);
    let source = bytes.toString('utf8');
    if (/\.(docx|html?)$/i.test(file)) {
      if (/\.docx$/i.test(file)) {
        const { default: mammoth } = await import('mammoth');
        source = (await mammoth.convertToHtml({ buffer: bytes })).value;
      }
      const { default: TurndownService } = await import('turndown');
      const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
      converter.remove(['script', 'style', 'noscript']);
      source = converter.turndown(source);
    }
    const started = performance.now();
    const model = analyzeDocument(source);
    let result;
    if (command === 'search') {
      const query = rest.join(' ').trim();
      if (!query) throw new TypeError('Search query is required');
      result = { file, query, matches: searchDocument(source, query, model) };
    } else if (command === 'outline') {
      result = { file, headings: model.outline };
    } else if (command === 'check') {
      result = {
        ok: model.chunks.length > 0 || source.length === 0,
        file,
        bytes: bytes.length,
        lines: model.lines,
        chunks: model.chunks.length,
        headings: model.outline.length,
        wordCount: model.wordCount,
        title: model.title,
        summary: model.summary,
      };
    } else {
      result = {
        file,
        bytes: bytes.length,
        lines: model.lines,
        chunks: model.chunks.length,
        headings: model.outline.length,
        wordCount: model.wordCount,
        title: model.title,
        summary: model.summary,
        analysisMs: Math.round(performance.now() - started),
      };
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message, file: path.resolve(fileArg) }));
    process.exitCode = 1;
  }
}
