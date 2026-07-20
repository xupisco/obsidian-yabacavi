import {
	DateValue,
	Keymap,
	LinkValue,
	ListValue,
	Menu,
	NullValue,
	TFile,
	type BasesEntry,
	type BasesPropertyId,
	type Value,
} from "obsidian";
import { VIEW_ID, type CalendarView } from "./calendar-view";
import { hasTime, toDayKey } from "./date-utils";

const MAX_CHIPS = 4;

/** Intrinsic file properties that carry no signal on a card. */
const FILE_PROPS_TO_SKIP = new Set(["name", "path", "folder", "ext"]);

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const shortDateFormat = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short" });

const WIKILINK = /^\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/;

function formatScalar(value: Value): string {
	if (value instanceof DateValue) {
		const date = (value as unknown as { date?: unknown }).date;
		return date instanceof Date ? shortDateFormat.format(date) : value.toString();
	}
	if (value instanceof LinkValue) {
		const match = WIKILINK.exec(value.toString());
		if (match) return match[2] ?? match[1];
		return value.toString();
	}
	return value.toString();
}

/**
 * Flatten a value into the pieces that each get their own element. A list
 * property like `tags` yields one entry per tag so each can be styled on its
 * own, rather than being flattened into one comma-joined string.
 */
function valueItems(value: Value): string[] {
	if (value instanceof ListValue) {
		const items: string[] = [];
		for (let i = 0; i < value.length(); i++) {
			const item = value.get(i);
			if (!item || item instanceof NullValue || !item.isTruthy()) continue;
			items.push(...valueItems(item));
		}
		return items;
	}
	const text = formatScalar(value);
	return text ? [text] : [];
}

/**
 * Tag values stringify with a leading "#" (e.g. `#work`), but the Bases table
 * renders them through the native tag component, which drops it. Match that so a
 * card and a table agree — same convention as the tag CSS ([data-property*="tags"]).
 */
function isTagProperty(propId: BasesPropertyId): boolean {
	return propId.includes("tags");
}

/** data-* keys the view itself owns; a frontmatter key must never overwrite them. */
const RESERVED_DATA_KEYS = new Set(["file-path", "day-key", "property", "placed-by"]);

/** Long prose in an attribute would bloat every card in the grid for nothing. */
const MAX_DATA_VALUE_LENGTH = 120;

/** `due date` -> `due-date`, for `[data-due-date="…"]`. Null if it can't make a
 *  legal attribute name, or would collide with one the card already owns. */
function dataKeyForName(name: string): string | null {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	// A data- attribute needs a valid XML name, which can't start with a digit.
	if (!slug || /^[0-9]/.test(slug)) return null;
	return RESERVED_DATA_KEYS.has(slug) ? null : slug;
}

/**
 * Turn a raw frontmatter value into an attribute string, or null to skip it.
 * Objects (nested maps) can't be matched on, so they're dropped.
 */
function frontmatterDataValue(value: unknown): string | null {
	if (value == null) return null;
	if (typeof value === "string") return value.trim() || null;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	// Some YAML parsers hand back a Date; keep it as a local ISO day so
	// `[data-deadline^="2026-07"]` works. toISOString would UTC-shift it.
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : toDayKey(value);
	if (Array.isArray(value)) {
		const tokens: string[] = [];
		for (const item of value) {
			const token = frontmatterDataValue(item);
			// Space-separated, spaces within an item collapsed, so `~=` matches one.
			if (token) tokens.push(token.replace(/\s+/g, "-"));
		}
		return tokens.length > 0 ? tokens.join(" ") : null;
	}
	return null;
}

/**
 * Mirror every frontmatter property of the note onto the card as data-<key>, so
 * a theme can restyle a card by its own values — `[data-status="done"]` — with
 * no need to make the property a visible column first.
 */
function applyDataAttributes(frontmatter: Record<string, unknown> | null, cardEl: HTMLElement): void {
	if (!frontmatter) return;

	for (const [name, raw] of Object.entries(frontmatter)) {
		const key = dataKeyForName(name);
		if (!key) continue;

		const text = frontmatterDataValue(raw);
		if (!text || text.length > MAX_DATA_VALUE_LENGTH) continue;

		cardEl.setAttr(`data-${key}`, text);
	}
}

/**
 * Colour the accent bar from the plugin's status→colour settings. Set inline so
 * it wins over a theme's data-status rules; skipped when no colour is configured
 * for this note's status, leaving the CSS default (or the theme) in charge.
 */
function applyAccentColor(
	view: CalendarView,
	frontmatter: Record<string, unknown> | null,
	cardEl: HTMLElement,
): void {
	if (!frontmatter) return;
	const raw = frontmatter[view.getStatusProperty()];
	// The property may be a plain string or a YAML list — Obsidian stores some
	// properties (single-select included) as a list, so `status: [todo]` arrives
	// as an array. Take the first value that maps to a configured colour.
	const values = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
	for (const value of values) {
		if (typeof value !== "string") continue;
		const color = view.getStatusColor(value.trim());
		if (color) {
			cardEl.style.setProperty("--yabacavi-accent-color", color);
			return;
		}
	}
}

/**
 * The properties to show on a card are whatever the user made visible in the
 * base's own config, minus the ones already implied by the card itself.
 */
function chipProperties(view: CalendarView): BasesPropertyId[] {
	const dateProp = view.getDatePropertyId();
	return view.config
		.getOrder()
		.filter((propId) => propId !== dateProp)
		.filter((propId) => !(propId.startsWith("file.") && FILE_PROPS_TO_SKIP.has(propId.slice(5))));
}

function openNote(view: CalendarView, file: TFile, evt: MouseEvent): void {
	// Shift-click opens a split; ctrl/cmd-click (and Obsidian's other modifiers)
	// open the pane type Obsidian picks — a new tab, etc.; a plain click follows the
	// configured "Open notes in" behaviour.
	if (evt.shiftKey) {
		evt.preventDefault();
		void view.app.workspace.getLeaf("split", "vertical").openFile(file);
		return;
	}
	const mod = Keymap.isModEvent(evt);
	if (mod) {
		evt.preventDefault();
		void view.app.workspace.getLeaf(mod).openFile(file);
		return;
	}

	view.openInBehavior(file);
}

export function renderCard(
	view: CalendarView,
	entry: BasesEntry,
	date: Date,
	container: HTMLElement,
	byCreation = false,
): HTMLElement {
	const file = entry.file;
	const cardEl = container.createDiv({ cls: "yabacavi-card" });
	cardEl.dataset.filePath = file.path;
	// A card placed by creation date is read-only (ctime can't be written back), so
	// flag it for CSS and the drag gate and don't mark it draggable. Everything else
	// reschedules on drop.
	if (byCreation) cardEl.dataset.placedBy = "created";
	else cardEl.setAttr("draggable", "true");

	const frontmatter: Record<string, unknown> | null =
		view.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
	applyDataAttributes(frontmatter, cardEl);
	applyAccentColor(view, frontmatter, cardEl);

	// card > [card-accent, card-body] as siblings: a colourable bar beside the
	// content. Drive the bar's colour off the card's data-status.
	cardEl.createDiv({ cls: "yabacavi-card-accent" });
	const bodyEl = cardEl.createDiv({ cls: "yabacavi-card-body" });

	const titleEl = bodyEl.createDiv({ cls: "yabacavi-card-title" });
	if (view.getShowTime() && hasTime(date)) {
		titleEl.createSpan({ cls: "yabacavi-card-time", text: timeFormat.format(date) });
	}
	titleEl.createSpan({ text: file.basename });

	let propsEl: HTMLElement | null = null;
	let chips = 0;
	for (const propId of chipProperties(view)) {
		if (chips >= MAX_CHIPS) break;

		const value = entry.getValue(propId);
		if (!value || value instanceof NullValue || !value.isTruthy()) continue;

		// Formulas can emit html(); let Bases render them so the markup survives.
		const isFormula = propId.startsWith("formula.");
		const items = isFormula ? [] : valueItems(value);
		// Bail before creating the element, or a value that renders to nothing
		// leaves an empty chip behind and its margin shows as phantom spacing.
		if (!isFormula && items.length === 0) continue;

		// Created on the first chip that survives, for the same reason: an empty
		// container still contributes its margin.
		if (!propsEl) propsEl = bodyEl.createDiv({ cls: "yabacavi-card-props" });

		const chipEl = propsEl.createDiv({ cls: "yabacavi-chip" });
		// Exposed so a theme can target one property: [data-property="note.tags"].
		chipEl.dataset.property = propId;
		chipEl.setAttr("aria-label", view.config.getDisplayName(propId));

		if (isFormula) {
			chipEl.addClass("yabacavi-chip--formula");
			value.renderTo(chipEl, view.app.renderContext);
		} else {
			const stripHash = isTagProperty(propId);
			for (const item of items) {
				chipEl.createSpan({
					cls: "yabacavi-chip-item",
					text: stripHash ? item.replace(/^#/, "") : item,
				});
			}
		}
		chips++;
	}

	cardEl.addEventListener("click", (evt) => openNote(view, file, evt));

	// mouseenter, not mouseover: the latter bubbles from every chip and would
	// re-trigger the popover constantly.
	cardEl.addEventListener("mouseenter", (evt) => {
		view.app.workspace.trigger("hover-link", {
			event: evt,
			source: VIEW_ID,
			hoverParent: view,
			targetEl: cardEl,
			linktext: file.path,
		});
	});

	cardEl.addEventListener("contextmenu", (evt) => {
		const menu = new Menu();
		view.app.workspace.trigger("file-menu", menu, file, "yabacavi-card");
		menu.showAtMouseEvent(evt);
	});

	return cardEl;
}
