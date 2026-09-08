import { useState, type ReactNode } from "react";
import * as SimpleMarkdown from "simple-markdown";

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
const FENCE_RE = /```(\w+)?\n?([\s\S]*?)```/g;

type Block =
  | { type: "code"; lang?: string; content: string }
  | { type: "quote"; lines: string[] }
  | { type: "header"; level: number; content: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "text"; lines: string[] };

function isBlockStart(line: string): boolean {
  return MULTI_QUOTE_RE.test(line) || QUOTE_RE.test(line) || HEADER_RE.test(line) || BULLET_RE.test(line) || NUMBERED_RE.test(line);
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
          <code>{block.content}</code>
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
