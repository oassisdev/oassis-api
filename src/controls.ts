/**
 * The `controls` format: a map of what can be acted on in the page.
 *
 * This is what an agent driving a browser needs and today has to piece together
 * by hand: the list of elements it can interact with, each one with its role, a
 * human-readable name, a selector and its box on screen. It comes from a single
 * `scrape` action over a fixed selector list, so it costs one render, not one
 * render per selector.
 */

/** Internal role: not a control, used to name the ones that are. */
const LABEL_ONLY = "__label";

/** Every actionable selector. Order decides the role when several match. */
const SELECTORS: { selector: string; role: string }[] = [
  { selector: "a[href]", role: "link" },
  { selector: "button", role: "button" },
  { selector: '[role="button"]', role: "button" },
  { selector: '[role="link"]', role: "link" },
  { selector: '[role="tab"]', role: "tab" },
  { selector: '[role="menuitem"]', role: "menuitem" },
  { selector: '[role="checkbox"]', role: "checkbox" },
  { selector: "input", role: "input" },
  { selector: "textarea", role: "textarea" },
  { selector: "select", role: "select" },
  { selector: "summary", role: "disclosure" },
  { selector: "[contenteditable]", role: "textbox" },
  { selector: "[onclick]", role: "button" },
  // Never returned: it is how a field ends up called "Customer name" instead of
  // "custname", which is what an agent actually needs to read.
  { selector: "label", role: LABEL_ONLY },
];

export const CONTROL_SELECTORS = SELECTORS.map((s) => ({ selector: s.selector }));

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Control {
  /** Positional reference within THIS render: `<selector>#<n>`. */
  ref: string;
  role: string;
  /** Readable name: text, or aria-label / value / placeholder / title / alt. */
  name: string;
  selector: string;
  /** Index of the match within its selector, starting at 0. */
  nth: number;
  box: Box;
  visible: boolean;
  disabled?: boolean;
  href?: string;
  type?: string;
  value?: string;
}

interface RawMatch {
  text?: string;
  html?: string;
  attributes?: { name: string; value: string }[] | Record<string, string>;
  top?: number;
  left?: number;
  width?: number;
  height?: number;
}

interface RawBlock {
  selector?: string;
  results?: RawMatch[];
}

function boxOf(m: RawMatch): Box {
  return {
    top: Math.round(m.top ?? 0),
    left: Math.round(m.left ?? 0),
    width: Math.round(m.width ?? 0),
    height: Math.round(m.height ?? 0),
  };
}

function attributesOf(a: RawMatch["attributes"]): Record<string, string> {
  if (!a) return {};
  if (Array.isArray(a)) {
    const o: Record<string, string> = {};
    for (const { name, value } of a) if (name) o[name.toLowerCase()] = value ?? "";
    return o;
  }
  return Object.fromEntries(Object.entries(a).map(([k, v]) => [k.toLowerCase(), String(v)]));
}

function clean(v: string | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * Name taken from the element's html as a last resort: a logo link has no text,
 * but its `<img>` usually has an `alt`.
 */
function fromHtml(html: string | undefined): string {
  if (!html) return "";
  const attr = /(?:alt|aria-label|title)\s*=\s*"([^"]+)"/i.exec(html);
  if (attr?.[1]) return clean(attr[1]);
  return clean(html.replace(/<[^>]*>/g, " "));
}

interface Labels {
  /** By the `for` attribute: `<label for="x">` names the element with `id="x"`. */
  byId: Map<string, string>;
  /** By geometry: a label wrapping a field does not need `for`. */
  byBox: { text: string; box: Box }[];
}

/**
 * The label wrapping the control, or the one sitting immediately to its left on
 * the same line. That is how a field is named in a form written without `for`,
 * which is half of the forms out there.
 */
function labelByBox(box: Box, labels: Labels["byBox"]): string | undefined {
  const SLACK = 4;
  const candidates = labels.filter((l) => {
    // A field usually pokes a couple of pixels out of the label that wraps it, so
    // containment is measured with horizontal slack and vertical overlap: a field can
    // start one line above its own label.
    const insideX =
      l.box.left <= box.left + SLACK && l.box.left + l.box.width >= box.left + box.width - SLACK;
    const overlap =
      Math.min(l.box.top + l.box.height, box.top + box.height) - Math.max(l.box.top, box.top);
    const contains = insideX && overlap >= Math.min(box.height, l.box.height) * 0.5;
    const toTheLeft =
      Math.abs(l.box.top - box.top) <= 12 &&
      l.box.left + l.box.width <= box.left &&
      box.left - (l.box.left + l.box.width) <= 40;
    return contains || toTheLeft;
  });
  if (candidates.length === 0) return undefined;
  // The smallest one: in nested forms, the label closest to the field.
  candidates.sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height);
  return candidates[0]?.text;
}

function controlName(m: RawMatch, attrs: Record<string, string>, box: Box, labels: Labels): string {
  const candidates = [
    m.text,
    attrs["aria-label"],
    attrs.id ? labels.byId.get(attrs.id) : undefined,
    labelByBox(box, labels.byBox),
    attrs.placeholder,
    attrs.value,
    attrs.title,
    attrs.alt,
    fromHtml(m.html),
    attrs.name,
  ];
  for (const candidate of candidates) {
    const cleaned = clean(candidate);
    if (cleaned) return cleaned;
  }
  return "";
}

/** An `<input>` can be a button, a checkbox or a radio: its `type` says which. */
function inputRole(type: string | undefined): string {
  switch ((type ?? "text").toLowerCase()) {
    case "submit":
    case "button":
    case "reset":
    case "image":
      return "button";
    case "checkbox":
      return "checkbox";
    case "radio":
      return "radio";
    case "file":
      return "fileinput";
    case "hidden":
      return "hidden";
    default:
      return "input";
  }
}

export interface ControlsOptions {
  visibleOnly?: boolean;
  limit?: number;
}

/**
 * Turns the raw `scrape` response into the control list: drops duplicates (one
 * element can match several selectors), sorts by position on screen and cuts to
 * the requested limit.
 */
export function mapControls(value: unknown, opts: ControlsOptions = {}): Control[] {
  const limit = opts.limit ?? 200;
  const visibleOnly = opts.visibleOnly ?? true;
  // The provider returns the array of blocks as-is; the wrapped
  // `{ results: [...] }` shape is accepted too because the docs describe it that
  // way and it is not worth depending on which one arrives.
  const raw = value as RawBlock[] | { results?: RawBlock[] } | null;
  const blocks = Array.isArray(raw) ? raw : raw?.results;
  if (!Array.isArray(blocks)) return [];

  const roleOf = new Map(SELECTORS.map((s) => [s.selector, s.role]));

  // First pass: the labels, so fields can be named.
  const labels: Labels = { byId: new Map(), byBox: [] };
  for (const block of blocks) {
    if (roleOf.get(block.selector ?? "") !== LABEL_ONLY) continue;
    for (const m of block.results ?? []) {
      const attrs = attributesOf(m.attributes);
      // The text of a label wrapping a field drags the field's value along; it
      // is cut at the colon, which is where the name ends.
      const text = clean((clean(m.text) || fromHtml(m.html)).split(/[:\n]/)[0]);
      if (!text) continue;
      if (attrs.for) labels.byId.set(attrs.for, text);
      const box = boxOf(m);
      if (box.width > 0 && box.height > 0) labels.byBox.push({ text, box });
    }
  }

  const seen = new Set<string>();
  const controls: Control[] = [];

  for (const block of blocks) {
    const selector = block.selector ?? "";
    const role = roleOf.get(selector) ?? "element";
    if (role === LABEL_ONLY) continue;
    const matches = Array.isArray(block.results) ? block.results : [];

    matches.forEach((m, nth) => {
      const attrs = attributesOf(m.attributes);
      const box = boxOf(m);
      const visible = box.width > 0 && box.height > 0;
      if (visibleOnly && !visible) return;

      // A button that also carries role="button" shows up twice: the first one
      // wins, which is the more specific selector according to SELECTORS.
      const name = controlName(m, attrs, box, labels);
      const fingerprint = `${role}|${name}|${box.top}|${box.left}|${box.width}|${box.height}`;
      if (seen.has(fingerprint)) return;
      seen.add(fingerprint);

      const control: Control = {
        ref: `${selector}#${nth}`,
        role: role === "input" ? inputRole(attrs.type) : role,
        name,
        selector,
        nth,
        box,
        visible,
      };
      if (attrs.disabled !== undefined) control.disabled = true;
      if (attrs.href) control.href = attrs.href;
      if (attrs.type) control.type = attrs.type;
      if (attrs.value) control.value = attrs.value.slice(0, 200);
      controls.push(control);
    });
  }

  controls.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  return controls.slice(0, limit);
}
