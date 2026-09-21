// A tree of a page's markup, enough to read the page by its structure:
// elements with their attributes and children, text with its entities
// decoded. Tolerant the way a browser is about what it does not understand,
// and deterministic, so the same page always reads the same.

export interface Element {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: Array<Node>;
}
export type Node = Element | string;

// Elements that never have content, so they never open.
const voidElements = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

// Elements whose content is not markup, read up to their closing tag.
const rawTextElements = new Set(['script', 'style', 'textarea']);

// A tag, a comment, or a declaration such as the doctype.
const markup = /<!--[\s\S]*?-->|<![^>]*>|<(\/?)([a-zA-Z][^\s/>]*)([^>]*)>/g;

const attribute = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

const named: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (entity, body: string) => {
    if (body.startsWith('#x')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number(body.slice(1)));
    return named[body.toLowerCase()] ?? entity;
  });

const parseAttributes = (body: string): Record<string, string> => {
  const attributes: Record<string, string> = {};
  for (let match = attribute.exec(body); match !== null; match = attribute.exec(body)) {
    const [, name, double, single, bare] = match;
    if (name === undefined || name === '/') continue;
    attributes[name.toLowerCase()] = decodeEntities(double ?? single ?? bare ?? '');
  }
  return attributes;
};

export const parseHtml = (html: string): Element => {
  const root: Element = { tag: '#root', attributes: {}, children: [] };
  const stack: Array<Element> = [root];
  const lower = html.toLowerCase();
  let position = 0;

  const text = (from: number, to: number) => {
    if (to > from) stack[stack.length - 1]!.children.push(decodeEntities(html.slice(from, to)));
  };

  for (let match = markup.exec(html); match !== null; match = markup.exec(html)) {
    text(position, match.index);
    position = markup.lastIndex;

    const [, closing, rawName, body = ''] = match;
    if (rawName === undefined) continue;
    const tag = rawName.toLowerCase();

    if (closing === '/') {
      // A closing tag closes the nearest open element of its name and
      // whatever was left open inside it; one that matches nothing is noise.
      const open = stack.findLastIndex((element) => element.tag === tag);
      if (open > 0) stack.length = open;
      continue;
    }

    const element: Element = { tag, attributes: parseAttributes(body), children: [] };
    stack[stack.length - 1]!.children.push(element);

    if (rawTextElements.has(tag)) {
      const end = lower.indexOf(`</${tag}`, position);
      element.children.push(html.slice(position, end === -1 ? html.length : end));
      const close = end === -1 ? -1 : html.indexOf('>', end);
      position = close === -1 ? html.length : close + 1;
      markup.lastIndex = position;
      continue;
    }
    if (!voidElements.has(tag) && !body.trimEnd().endsWith('/')) stack.push(element);
  }
  text(position, html.length);
  return root;
};

export const isElement = (node: Node): node is Element => typeof node !== 'string';

const rawText = (node: Node): string =>
  isElement(node) ? node.children.map(rawText).join('') : node;

// The text a reader sees: whitespace collapsed the way a browser lays it out.
export const textOf = (node: Node): string => rawText(node).replace(/\s+/g, ' ').trim();

export const hasClass = (element: Element, name: string): boolean =>
  (element.attributes['class'] ?? '').split(/\s+/).includes(name);

export const children = (element: Element): Array<Element> => element.children.filter(isElement);

function* descendants(element: Element): Generator<Element> {
  for (const child of element.children) {
    if (isElement(child)) {
      yield child;
      yield* descendants(child);
    }
  }
}

export const find = (
  element: Element,
  predicate: (candidate: Element) => boolean,
): Element | undefined => {
  for (const candidate of descendants(element)) if (predicate(candidate)) return candidate;
  return undefined;
};

export const findAll = (
  element: Element,
  predicate: (candidate: Element) => boolean,
): Array<Element> => [...descendants(element)].filter(predicate);
