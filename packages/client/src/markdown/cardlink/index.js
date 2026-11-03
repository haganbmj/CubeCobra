import { visit } from 'unist-util-visit';

import { fromMarkdown } from 'markdown/cardlink/mdast-cardlink';
import syntax from 'markdown/cardlink/micromark-cardlink';
import { add } from 'markdown/utils';

const P1P1_PREFIX = 'p1p1:';
// Canonical 8-4-4-4-12 hex form, matching the shape of the UUIDs this app actually generates.
// Joi's default `.uuid()` (used server-side in getp1p1.ts) is intentionally looser - it also accepts
// bracket-wrapped and colon-separated GUIDs of any version - but none of that is a shape a real pack id
// ever takes, so there is no reason to let it through here too.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Split `value` on the first occurrence of `delimiter` only, leaving any further occurrences
 * (inside a caption, say) in the second half intact.
 */
function splitFirst(value, delimiter) {
  const index = value.indexOf(delimiter);
  if (index === -1) {
    return [value, undefined];
  }
  return [value.slice(0, index), value.slice(index + delimiter.length)];
}

function onp1p1(node, remainder, allowEmbeds, inParagraph) {
  /* Tables don't allow raw pipes (|) in their cell contents unless escaped - see the comment on
   * markCardlinksInTables below - so mirror the cardlink id/name split: prefer an escaped `\|` split
   * over a plain `|` split, and in either case split on the FIRST occurrence only so a caption
   * containing further pipes survives intact.
   */
  let [id, caption] = splitFirst(remainder, '\\|');
  if (typeof caption === 'undefined') {
    [id, caption] = splitFirst(remainder, '|');
  }

  if (!allowEmbeds || !UUID_REGEX.test(id)) {
    // Either the surface hasn't opted into embeds, or the id is malformed: render the original
    // token source as plain text rather than falling through to an autocard link literally named
    // "p1p1:<whatever was typed>".
    node.type = 'text';
    node.value = `[[${node.value}]]`;
    delete node.data.hName;
    delete node.data.hProperties;
    return;
  }

  node.type = 'p1p1embed';
  node.data.hName = 'p1p1embed';
  node.data.hProperties = {
    id,
    caption,
    inTable: node.inTable,
    inParagraph,
  };
}

function oncard(node, index, parent, allowEmbeds) {
  // Needed to determine whether the embed/image is rendered in a div or in a span: the token is
  // inline, so a direct paragraph parent (or a parent that is itself already flagged, e.g. a
  // cardimage nested one level deeper) means a block wrapper would be invalid HTML.
  const inParagraph = parent.type === 'paragraph' || parent.inParagraph;

  if (node.value.startsWith(P1P1_PREFIX)) {
    onp1p1(node, node.value.slice(P1P1_PREFIX.length), allowEmbeds, inParagraph);
    return;
  }

  if (node.value[0] === '!') {
    // Begins with an exclamation point -> it's a card image
    node.value = node.value.substring(1);
    node.type = 'cardimage';
  }

  if (node.value[0] === '/') {
    // Begins with a slash -> include back side in autocard
    node.value = node.value.substring(1);
    node.dfc = true;
  }

  if (node.value[0] === '/') {
    // A second slash means we want to show the back side on the page
    node.value = node.value.substring(1);
    node.showBackImage = true;
  }

  if (node.value[0] === '!' && node.type !== 'cardimage') {
    // Check for exclamation point again in case we began with "/!"
    node.value = node.value.substring(1);
    node.type = 'cardimage';
  }

  if (node.type === 'cardimage' && inParagraph) {
    // Needed to determine whether the image is rendered in a div or in a span
    node.inParagraph = true;
  }

  /* Per https://github.com/micromark/micromark-extension-gfm-table?tab=readme-ov-file#syntax tables don't allow
   * pipes (|) in their cell contents unless escaped. So let's first check if there is the escaped version to split
   * Card name and id, otherwise check for just a normal pipe
   */
  [node.name, node.id] = node.value.split('\\|');
  if (typeof node.id === 'undefined') {
    [node.name, node.id] = node.value.split('|');
  }

  if (typeof node.id === 'undefined') {
    node.id = node.name;
  }

  node.data.hName = node.type;
  node.data.hProperties = {
    name: node.name,
    id: node.id,
    dfc: node.dfc,
    inParagraph: node.inParagraph,
    inTable: node.inTable,
    showBackImage: node.showBackImage,
  };
}

/* Mark every cardlink that lives anywhere inside a table cell. We walk each cell's whole subtree
 * rather than testing `parent.type`, because a card image inside a `<<...>>` row has the cardrow as
 * its parent, not the cell. This has to run before `oncard`, which rewrites `node.type` from
 * 'cardlink' to 'cardimage'.
 */
function markCardlinksInTables(tree) {
  visit(tree, 'tableCell', (cell) => {
    visit(cell, 'cardlink', (node) => {
      node.inTable = true;
    });
  });
}

/* A token written alone on its own line is the common way to author a p1p1 embed, and it parses as
 * a paragraph whose only child is the embed. Left as-is, that forces the embed's frame into the
 * `inParagraph` span form, which still nests the tile's own block content (the card grid, built from
 * `div`s) inside a `<p>` - exactly the invalid, React-misnesting case `inParagraph` exists to avoid,
 * just one level further down. So: unwrap a paragraph whose sole content is one `p1p1embed`, replacing
 * the paragraph with the embed itself. The tile then renders at the block level it actually needs.
 *
 * An embed sharing its paragraph with other content (surrounding prose) is left alone - that is the
 * genuinely inline case, and `inParagraph`'s span wrapper is the right fix for it.
 *
 * This has to run after the `cardlink` visit below, since a node is only a `p1p1embed` once `oncard`
 * has rewritten it.
 */
function unwrapSoloEmbedParagraphs(tree) {
  visit(tree, 'paragraph', (node, index, parent) => {
    if (!parent || typeof index !== 'number') return;
    if (node.children.length !== 1 || node.children[0].type !== 'p1p1embed') return;

    const embed = node.children[0];
    // No longer inline in a paragraph - it replaced one - so the frame should pick its block (div) form.
    if (embed.data?.hProperties) {
      embed.data.hProperties.inParagraph = false;
    }
    parent.children[index] = embed;
  });
}

function cardlinks(options = {}) {
  const { allowEmbeds = false } = options;
  const data = this.data();
  add(data, 'micromarkExtensions', syntax);
  add(data, 'fromMarkdownExtensions', fromMarkdown);
  return (tree) => {
    markCardlinksInTables(tree);
    visit(tree, 'cardlink', (node, index, parent) => oncard(node, index, parent, allowEmbeds));
    unwrapSoloEmbedParagraphs(tree);
  };
}

export default cardlinks;
