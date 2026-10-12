/**
 * @file base-styles.ts
 * @purpose The stylesheet ProseMirror needs on its editable element, for hosts that do not load prosemirror-view's CSS file.
 * @inputs None.
 * @outputs PROSEMIRROR_BASE_STYLES.
 * @functions None; one exported constant.
 * @dataflow Constant CSS text -> the host's stylesheet, ahead of its own .ProseMirror rules so those can override.
 * @controlflow None.
 * @version 1
 * @date 2026-09-16
 */

/**
 * The CSS ProseMirror requires on its editable element (from prosemirror-view/style/prosemirror.css), minus the parts the
 * K-Doc theme draws itself. Without `white-space: pre-wrap` a space at the end of a line collapses, so the next keystroke
 * typed after a space that a command or an autocorrect rule inserted replaces that space, and runs of spaces vanish.
 */
export const PROSEMIRROR_BASE_STYLES: string = `
.ProseMirror {
  position: relative;
  word-wrap: break-word;
  white-space: pre-wrap;
  white-space: break-spaces;
  -webkit-font-variant-ligatures: none;
  font-variant-ligatures: none;
  font-feature-settings: "liga" 0;
}
.ProseMirror pre { white-space: pre-wrap; }
.ProseMirror li { position: relative; }
.ProseMirror-hideselection *::selection { background: transparent; }
.ProseMirror-hideselection { caret-color: transparent; }
.ProseMirror [draggable][contenteditable=false] { user-select: text; }
img.ProseMirror-separator { display: inline !important; border: none !important; margin: 0 !important; }
`;
