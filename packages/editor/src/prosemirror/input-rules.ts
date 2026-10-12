/**
 * @file input-rules.ts
 * @purpose Pure ProseMirror input rules for K-Doc's WYSIWYG pane, implementing Markdown auto-formatting as you type (FR-7.7).
 *   Transforms typed Markdown patterns (headings, code blocks, blockquotes, lists, horizontal rules, and inline marks)
 *   into corresponding ProseMirror document nodes and marks without DOM dependencies, supporting headless testing.
 * @inputs KdocInputRulesOptions with optional custom Schema, and user text insertion events via ProseMirror's inputrules plugin.
 * @outputs ProseMirror Plugin executing Markdown input rules on text input, and the standalone markInputRule factory function.
 * @functions
 *   - markInputRule: Creates an InputRule transforming typed inline markdown delimiters into a ProseMirror mark.
 *   - createKdocInputRules: Constructs the ProseMirror inputrules plugin for block and inline Markdown formatting.
 * @dataflow User text input -> regex pattern match -> Transaction replacing delimiters with nodes or marks -> updated EditorState.
 * @controlflow Resolve schema node/mark types -> assemble active InputRule instances -> register with inputRules plugin.
 * @version 1
 * @date 2026-09-05
 */

import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import type { Plugin } from 'prosemirror-state';
import type { MarkType, NodeType, Schema } from 'prosemirror-model';
import { kdocSchema } from './schema.js';

/**
 * Options for configuring K-Doc's ProseMirror input rules plugin.
 */
export interface KdocInputRulesOptions {
  /**
   * Optional ProseMirror schema to resolve node and mark types against.
   * Defaults to `kdocSchema` when omitted.
   */
  readonly schema?: Schema;
}

/**
 * @purpose Creates an InputRule transforming typed inline markdown delimiters into a ProseMirror mark.
 * @inputs
 *   - pattern: RegExp - The regular expression to match against the typed text ending with $, with exactly one capture group holding the text to keep.
 *   - markType: MarkType - The ProseMirror mark type to apply to the captured text.
 * @outputs InputRule - An InputRule applying the mark to the captured text and clearing stored marks.
 * @dataflow match[1] extraction -> tr.delete(start, end) -> tr.insertText(captured, start) -> tr.addMark() -> tr.removeStoredMark() -> tr.
 * @controlflow Test match[1] -> if undefined, return null; if defined, replace match range with captured text, apply mark, clear stored mark, and return tr.
 */
export function markInputRule(pattern: RegExp, markType: MarkType): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const captured = match[1];
    // Check whether the pattern captured the inner text to be marked.
    // When the pattern did not capture, there is nothing to mark: returning null leaves the typed text alone.
    if (captured === undefined) {
      // No capture group found: leave the typed text unchanged.
      return null;
    } else {
      // Capture group present: proceed to replace delimiters and apply the mark.
    }

    const tr = state.tr;
    // Replace the whole match (delimiters included) with just the captured text, then mark it.
    tr.delete(start, end);
    tr.insertText(captured, start);
    tr.addMark(start, start + captured.length, markType.create());
    // Stored marks are cleared so the very next character typed is NOT also marked — otherwise
    // typing `**bold** more` would carry the bold onward, which is not what the user asked for.
    tr.removeStoredMark(markType);
    return tr;
  });
}

/**
 * @purpose Constructs the ProseMirror inputrules plugin configured with Markdown auto-formatting input rules (FR-7.7).
 * @inputs options: KdocInputRulesOptions | undefined - Optional configuration containing a custom ProseMirror schema.
 * @outputs Plugin - A ProseMirror plugin executing Markdown input rules as the user types.
 * @dataflow Resolves schema node and mark types -> builds array of active InputRule instances -> inputRules({ rules }).
 * @controlflow Resolve schema (defaulting to kdocSchema) -> look up node and mark types -> selectively push valid rules -> return inputRules plugin.
 */
export function createKdocInputRules(options?: KdocInputRulesOptions): Plugin {
  const schema = options?.schema ?? kdocSchema;
  // Node and mark types are resolved defensively from the schema.
  // Under noUncheckedIndexedAccess, indexed lookups on schema.nodes and schema.marks return Type | undefined.
  // We selectively push only rules whose corresponding schema types are defined: this ensures a reduced or custom
  // schema simply gets fewer rules rather than crashing the editor.
  const rules: InputRule[] = [];

  const headingType: NodeType | undefined = schema.nodes['heading'];
  // Check if heading node type exists in the schema.
  if (headingType !== undefined) {
    // Heading node type resolved: register heading input rule.
    // The trailing \s makes the rule fire on the space character rather than on the # itself,
    // ensuring typing #hashtag is left alone.
    rules.push(
      textblockTypeInputRule(
        /^(#{1,6})\s$/,
        headingType,
        (match) => ({ level: match[1]?.length ?? 1 }),
      ),
    );
  } else {
    // Heading node type missing from schema: skip heading input rule.
  }

  const codeBlockType: NodeType | undefined = schema.nodes['codeBlock'];
  // Check if code block node type exists in the schema.
  if (codeBlockType !== undefined) {
    // Code block node type resolved: register code block input rule for triple backticks.
    rules.push(
      textblockTypeInputRule(
        /^```$/,
        codeBlockType,
        () => ({ lang: null }),
      ),
    );
  } else {
    // Code block node type missing from schema: skip code block input rule.
  }

  const blockquoteType: NodeType | undefined = schema.nodes['blockquote'];
  // Check if blockquote node type exists in the schema.
  if (blockquoteType !== undefined) {
    // Blockquote node type resolved: register blockquote wrapping input rule.
    rules.push(
      wrappingInputRule(
        /^\s*>\s$/,
        blockquoteType,
      ),
    );
  } else {
    // Blockquote node type missing from schema: skip blockquote input rule.
  }

  const bulletListType: NodeType | undefined = schema.nodes['bulletList'];
  // Check if bullet list node type exists in the schema.
  if (bulletListType !== undefined) {
    // Bullet list node type resolved: register bullet list wrapping input rule for -, +, or *.
    rules.push(
      wrappingInputRule(
        /^\s*([-+*])\s$/,
        bulletListType,
      ),
    );
  } else {
    // Bullet list node type missing from schema: skip bullet list input rule.
  }

  const orderedListType: NodeType | undefined = schema.nodes['orderedList'];
  // Check if ordered list node type exists in the schema.
  if (orderedListType !== undefined) {
    // Ordered list node type resolved: register ordered list wrapping input rule.
    // The join predicate is subtle: it checks whether the typed number continues the sequence of an existing list.
    // This stops "1." typed inside an existing list from starting a second list when the numbering does not actually continue.
    rules.push(
      wrappingInputRule(
        /^(\d+)\.\s$/,
        orderedListType,
        (match) => ({ start: Number(match[1] ?? '1') }),
        (match, node) => node.childCount + (node.attrs['start'] as number) === Number(match[1] ?? '1'),
      ),
    );
  } else {
    // Ordered list node type missing from schema: skip ordered list rule.
  }

  const thematicBreakType: NodeType | undefined = schema.nodes['thematicBreak'];
  // Check if thematic break node type exists in the schema.
  if (thematicBreakType !== undefined) {
    // Thematic break node type resolved: register thematic break input rule for ---, ___, or ***.
    // start - 1 reaches back over the paragraph's opening token so the empty paragraph is replaced
    // rather than left behind as a stray blank block.
    rules.push(
      new InputRule(
        /^(?:---|___|\*\*\*)$/,
        (state, _match, start, end) => {
          const tr = state.tr.replaceWith(start - 1, end, thematicBreakType.create());
          return tr;
        },
      ),
    );
  } else {
    // Thematic break node type missing from schema: skip thematic break input rule.
  }

  const strongType: MarkType | undefined = schema.marks['strong'];
  // Check if strong mark type exists in the schema.
  if (strongType !== undefined) {
    // Strong mark type resolved: register double asterisk rule for bold formatting.
    rules.push(markInputRule(/(?:\*\*)([^*]+)(?:\*\*)$/, strongType));
  } else {
    // Strong mark type missing from schema: skip strong mark rule.
  }

  const strikethroughType: MarkType | undefined = schema.marks['strikethrough'];
  // Check if strikethrough mark type exists in the schema.
  if (strikethroughType !== undefined) {
    // Strikethrough mark type resolved: register double tilde rule for strikethrough formatting.
    rules.push(markInputRule(/(?:~~)([^~]+)(?:~~)$/, strikethroughType));
  } else {
    // Strikethrough mark type missing from schema: skip strikethrough mark rule.
  }

  const highlightType: MarkType | undefined = schema.marks['highlight'];
  // Check if highlight mark type exists in the schema.
  if (highlightType !== undefined) {
    // Highlight mark type resolved: register double equals rule for highlight formatting.
    rules.push(markInputRule(/(?:==)([^=]+)(?:==)$/, highlightType));
  } else {
    // Highlight mark type missing from schema: skip highlight mark rule.
  }

  const subscriptType: MarkType | undefined = schema.marks['subscript'];
  // Check if subscript mark type exists in the schema.
  if (subscriptType !== undefined) {
    // Subscript mark type resolved: register single tilde rule for subscript formatting.
    // The negative lookbehind (?<![~]) keeps ~~strikethrough~~ from being taken as a subscript.
    // The \s exclusion stops a lone ~ in ordinary prose from swallowing a whole phrase.
    rules.push(markInputRule(/(?<![~])~([^~\s]+)~$/, subscriptType));
  } else {
    // Subscript mark type missing from schema: skip subscript mark rule.
  }

  const superscriptType: MarkType | undefined = schema.marks['superscript'];
  // Check if superscript mark type exists in the schema.
  if (superscriptType !== undefined) {
    // Superscript mark type resolved: register single caret rule for superscript formatting.
    // The \s exclusion stops a lone ^ in ordinary prose from swallowing a whole phrase.
    rules.push(markInputRule(/\^([^^\s]+)\^$/, superscriptType));
  } else {
    // Superscript mark type missing from schema: skip superscript mark rule.
  }

  const emphasisType: MarkType | undefined = schema.marks['emphasis'];
  // Check if emphasis mark type exists in the schema.
  if (emphasisType !== undefined) {
    // Emphasis mark type resolved: register single asterisk rule for italic formatting.
    // The negative lookbehind (?<![*]) keeps **bold** from being eaten by the emphasis rule
    // after the strong rule has already had its turn.
    rules.push(markInputRule(/(?<![*])\*([^*]+)\*$/, emphasisType));
  } else {
    // Emphasis mark type missing from schema: skip emphasis mark rule.
  }

  const inlineCodeType: MarkType | undefined = schema.marks['inlineCode'];
  // Check if inline code mark type exists in the schema.
  if (inlineCodeType !== undefined) {
    // Inline code mark type resolved: register backtick rule for inline code formatting.
    rules.push(markInputRule(/(?:`)([^`]+)(?:`)$/, inlineCodeType));
  } else {
    // Inline code mark type missing from schema: skip inline code mark rule.
  }

  return inputRules({ rules });
}
