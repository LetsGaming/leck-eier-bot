import { useState, type ReactNode } from "react";
import * as SimpleMarkdown from "simple-markdown";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-css";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-yaml";
// prism-typescript depends on (and registers) prism-javascript itself, so a
// separate `prism-javascript` import isn't needed to cover both `js` and `ts`.

/** Discord-recognized language tags that don't match their Prism component name 1:1. */
const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
};

function resolveGrammar(lang: string | undefined): { grammar: Prism.Grammar; name: string } | null {
  if (!lang) return null;
  const name = LANG_ALIASES[lang.toLowerCase()] ?? lang.toLowerCase();
  const grammar = Prism.languages[name];
  return grammar ? { grammar, name } : null;
}

/** Turns Prism's token tree into React elements directly (no `dangerouslySetInnerHTML`, matching this file's all-React rendering elsewhere) — Prism's own `.highlight()` returns an HTML string, but `.tokenize()` returns the same tree `.highlight()` would otherwise stringify, so this walks that instead. */
function tokensToReact(tokens: (string | Prism.Token)[], keyPrefix: string): ReactNode[] {
  return tokens.map((tok, i) => {
    if (typeof tok === "string") return tok;
    const key = `${keyPrefix}-${i}`;
    const content = Array.isArray(tok.content)
      ? tokensToReact(tok.content, key)
      : typeof tok.content === "string"
        ? tok.content
        : tokensToReact([tok.content], key);
    return (
      <span key={key} className={`token ${tok.type}`}>
        {content}
      </span>
    );
  });
}

/** Syntax-highlights a fenced code block's content for a recognized language tag — returns the content unhighlighted (but still safely rendered as React text, never raw HTML) for an unrecognized or missing language, same as Discord's own client falling back to plain monospace. */
function highlightCode(code: string, lang: string | undefined): ReactNode {
  const resolved = resolveGrammar(lang);
  if (!resolved) return code;
  return tokensToReact(Prism.tokenize(code, resolved.grammar), "tok");
}

/**
 * Renders text through Discord's actual markdown grammar — not a generic
 * markdown renderer. The differences from standard/CommonMark markdown that
 * matter here, all deliberate:
 *
 * - `__text__` is underline, not bold (`**text**` is bold) — this is
 *   Discord's own convention, and happens to be simple-markdown's default
 *   `u`/`strong` split too, so those two rules are reused as-is.
 * - `||text||` is a click-to-reveal spoiler — not part of any standard
 *   markdown flavor, implemented as a custom inline rule below.
 * - No blank-line-separated paragraphs: every single `\n` is a hard line
 *   break, exactly as Discord renders it, never collapsed or requiring a
 *   blank line to "count". This is why block splitting is hand-rolled
 *   instead of using simple-markdown's own block parser, which assumes
 *   CommonMark-style paragraphs (blank-line-terminated) — Discord's grammar
 *   doesn't have that concept at all.
 * - Only `#`/`##`/`###` headers exist (no h4-h6), only single-level lists,
 *   and code fences render as a plain monospace block with no syntax
 *   coloring — matching what a code block missing a recognized language
 *   looks like in Discord, which covers the overwhelming majority of
 *   dashboard-authored templates (mission announcements, not source dumps).
 *   `simple-markdown`, not `discord-markdown`, is the dependency here for
 *   exactly this reason: `discord-markdown` pulls in the full `highlight.js`
 *   (~900KB) for that syntax coloring, nearly 3x this dashboard's entire
 *   current bundle, to color a feature most templates never use.
 */

function DiscordSpoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`discord-md-spoiler${revealed ? " revealed" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => setRevealed(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") setRevealed(true);
      }}
    >
      {children}
    </span>
  );
}

const inlineRules: SimpleMarkdown.ReactRules = {
  text: SimpleMarkdown.defaultRules.text,
  escape: SimpleMarkdown.defaultRules.escape,
  strong: SimpleMarkdown.defaultRules.strong,
  em: SimpleMarkdown.defaultRules.em,
  u: SimpleMarkdown.defaultRules.u,
  del: SimpleMarkdown.defaultRules.del,
  inlineCode: SimpleMarkdown.defaultRules.inlineCode,
  spoiler: {
    // Between em/strong (needs to win over `*`/`_`-based rules on `|` text,
    // which never applies, but matches simple-markdown's convention of
    // slotting new inline rules in near strong/em/u/del) and inlineCode.
    order: SimpleMarkdown.defaultRules.strong.order + 0.1,
    match: SimpleMarkdown.inlineRegex(/^\|\|([\s\S]+?)\|\|/),
    parse(capture, parse, state) {
      return { content: parse(capture[1]!, state) };
    },
    react(node, output, state) {
      return (
        <DiscordSpoiler key={state.key}>{output(node.content, state)}</DiscordSpoiler>
      );
    },
  } as SimpleMarkdown.ReactOutputRule & SimpleMarkdown.SingleNodeParserRule,
};

const parseInline = SimpleMarkdown.parserFor(inlineRules);
const outputInline = SimpleMarkdown.outputFor(inlineRules, "react");

function renderInline(text: string): ReactNode {
  if (!text) return null;
  const ast = parseInline(text, { inline: true });
  return outputInline(ast, { inline: true });
}

/** One line of a "plain text" block, inline-rendered, `<br/>`-joined with its siblings so every literal `\n` stays a hard break. */
function renderLines(lines: string[], keyPrefix: string): ReactNode {
  return lines.map((line, i) => (
    <span key={`${keyPrefix}-${i}`}>
      {i > 0 && <br />}
      {renderInline(line)}
    </span>
  ));
}

const HEADER_RE = /^(#{1,3})\s+(.*)$/;
const BULLET_RE = /^[-*]\s+(.*)$/;
const NUMBERED_RE = /^\d+\.\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const MULTI_QUOTE_RE = /^>>>\s?(.*)$/;
/** Discord's "subtext" line — small muted text, unrelated to a bullet list despite the leading `-` (no space between `-` and `#`, unlike `BULLET_RE`, so the two never collide). */
const SUBTEXT_RE = /^-#\s+(.*)$/;
const FENCE_RE = /```(\w+)?\n?([\s\S]*?)```/g;

type Block =
  | { type: "code"; lang?: string; content: string }
  | { type: "quote"; lines: string[] }
  | { type: "header"; level: number; content: string }
  | { type: "subtext"; content: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "text"; lines: string[] };

function isBlockStart(line: string): boolean {
  return (
    MULTI_QUOTE_RE.test(line) || QUOTE_RE.test(line) || SUBTEXT_RE.test(line) || HEADER_RE.test(line) || BULLET_RE.test(line) || NUMBERED_RE.test(line)
  );
}

/** Classifies one fence-free segment's lines into header/quote/list/text blocks, Discord's line-start-driven way (not CommonMark's blank-line-driven way — see this file's header comment). */
function classifyProse(content: string, blocks: Block[]): void {
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    const multiQuote = MULTI_QUOTE_RE.exec(line);
    if (multiQuote) {
      // >>> quotes everything remaining in this segment, Discord's own rule.
      blocks.push({ type: "quote", lines: [multiQuote[1]!, ...lines.slice(i + 1)] });
      return;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      const quoteLines = [quote[1]!];
      i++;
      while (i < lines.length) {
        const m = QUOTE_RE.exec(lines[i]!);
        if (!m || MULTI_QUOTE_RE.test(lines[i]!)) break;
        quoteLines.push(m[1]!);
        i++;
      }
      blocks.push({ type: "quote", lines: quoteLines });
      continue;
    }

    const subtext = SUBTEXT_RE.exec(line);
    if (subtext) {
      blocks.push({ type: "subtext", content: subtext[1]! });
      i++;
      continue;
    }

    const header = HEADER_RE.exec(line);
    if (header) {
      blocks.push({ type: "header", level: header[1]!.length, content: header[2]! });
      i++;
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    const numbered = NUMBERED_RE.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered;
      const re = ordered ? NUMBERED_RE : BULLET_RE;
      const items = [(ordered ? numbered : bullet)![1]!];
      i++;
      while (i < lines.length) {
        const m = re.exec(lines[i]!);
        if (!m) break;
        items.push(m[1]!);
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const plainLines = [line];
    i++;
    while (i < lines.length && !isBlockStart(lines[i]!)) {
      plainLines.push(lines[i]!);
      i++;
    }
    blocks.push({ type: "text", lines: plainLines });
  }
}

function splitIntoBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(source))) {
    if (match.index > lastIndex) classifyProse(source.slice(lastIndex, match.index), blocks);
    blocks.push({ type: "code", lang: match[1], content: match[2]!.replace(/\n$/, "") });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < source.length) classifyProse(source.slice(lastIndex), blocks);
  return blocks;
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case "code":
      return (
        <pre key={key} className="discord-md-codeblock">
          {block.lang && <div className="discord-md-codeblock-lang">{block.lang}</div>}
          <code>{highlightCode(block.content, block.lang)}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote key={key} className="discord-md-quote">
          {renderLines(block.lines, `q${key}`)}
        </blockquote>
      );
    case "header":
      return (
        <div key={key} className={`discord-md-h${block.level}`}>
          {renderInline(block.content)}
        </div>
      );
    case "subtext":
      return (
        <div key={key} className="discord-md-subtext">
          {renderInline(block.content)}
        </div>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag key={key} className="discord-md-list">
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </Tag>
      );
    }
    case "text":
      return (
        <div key={key} className="discord-md-line">
          {renderLines(block.lines, `t${key}`)}
        </div>
      );
  }
}

/** Renders `text` exactly as Discord's own client would format it — see this file's header comment for the grammar and the scoping decisions behind it. */
export function renderDiscordMarkdown(text: string): ReactNode {
  if (!text) return null;
  return splitIntoBlocks(text).map((block, i) => renderBlock(block, i));
}
