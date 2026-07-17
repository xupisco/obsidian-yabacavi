import {
	BasesView,
	Notice,
	TFile,
	parsePropertyId,
	setIcon,
	type BasesEntry,
	type BasesPropertyId,
	type HoverParent,
	type HoverPopover,
	type QueryController,
	type WorkspaceLeaf,
} from "obsidian";
import type YabacaviPlugin from "./main";
import { renderCard } from "./card";
import { createDailyNote, getDailyNote } from "./daily-notes";
import { DragDropManager } from "./drag-drop";
import { NoteModal } from "./note-modal";
import {
	addDays,
	addMonths,
	composeDateValue,
	extractDate,
	isSameDay,
	isWeekend,
	parseDayKey,
	startOfDay,
	startOfWeek,
	toDayKey,
	type DayKey,
	type WeekStart,
} from "./date-utils";
import {
	CONFIG_DATE_PROPERTY,
	CONFIG_RANGE,
	CONFIG_SHOW_TIME,
	CONFIG_SHOW_WEEKENDS,
	CONFIG_WEEK_START,
	type OpenBehavior,
	type RangeMode,
} from "./view-options";

export const VIEW_ID = "calendar-cards";

const RENDER_DEBOUNCE_MS = 50;
const RANGES: RangeMode[] = ["day", "week", "month"];

const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const monthTitleFormat = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const dayTitleFormat = new Intl.DateTimeFormat(undefined, {
	weekday: "long",
	day: "numeric",
	month: "long",
});
const weekTitleFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

interface CardItem {
	entry: BasesEntry;
	date: Date;
}

export class CalendarView extends BasesView implements HoverParent {
	type = VIEW_ID;
	hoverPopover: HoverPopover | null = null;
	/** Reused by the "split" open behaviour so each click doesn't spawn a new pane. */
	detailLeaf: WorkspaceLeaf | null = null;

	private plugin: YabacaviPlugin;
	private rootEl: HTMLElement;
	private titleEl!: HTMLElement;
	private modesEl!: HTMLElement;
	private bodyEl: HTMLElement;
	private dragDrop: DragDropManager;

	/** The date the visible range is derived from. Navigation state, not persisted. */
	private anchor: Date = startOfDay(new Date());
	private renderTimer: number | null = null;
	/** Cards already moved on screen whose frontmatter write hasn't round-tripped yet. */
	private optimistic = new Map<string, DayKey>();
	private isWriting = false;
	private pendingData = false;

	constructor(controller: QueryController, containerEl: HTMLElement, plugin: YabacaviPlugin) {
		super(controller);
		this.plugin = plugin;
		this.rootEl = containerEl.createDiv({ cls: "yabacavi" });
		this.buildToolbar(this.rootEl.createDiv({ cls: "yabacavi-toolbar" }));
		this.bodyEl = this.rootEl.createDiv({ cls: "yabacavi-body" });

		this.dragDrop = new DragDropManager(this.rootEl, {
			canDrag: () => this.isEditable(),
			onCardDrop: (filePath, dayKey) => void this.moveCard(filePath, dayKey),
		});

		// Registered so a settings change (e.g. status colours) can re-render us.
		this.plugin.trackView(this);

		// Daily notes live outside the base's query, so their create/delete never
		// reaches onDataUpdated — watch the vault so the day-header icons don't go
		// stale (this also flips the icon right after we create one ourselves).
		this.registerEvent(this.app.vault.on("create", () => this.onVaultChanged()));
		this.registerEvent(this.app.vault.on("delete", () => this.onVaultChanged()));
		this.registerEvent(this.app.vault.on("rename", () => this.onVaultChanged()));
	}

	private onVaultChanged(): void {
		if (this.plugin.settings.showDailyNote) this.scheduleRender();
	}

	onunload(): void {
		this.plugin.untrackView(this);
		this.dragDrop.destroy();
		if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
	}

	/** Re-render with current data — used when settings change. */
	refresh(): void {
		this.render();
	}

	getStatusProperty(): string {
		return this.plugin.settings.statusProperty || "status";
	}

	getStatusColor(value: string): string | null {
		const match = this.plugin.settings.statusColors.find((entry) => entry.value === value);
		return match && match.color ? match.color : null;
	}

	onDataUpdated(): void {
		// Our own write is still in flight. The update carrying that write can land
		// mid-await, so remember it — dropping it outright would strand the card's
		// optimistic position and mask every later edit to the property.
		if (this.isWriting) {
			this.pendingData = true;
			return;
		}
		this.acknowledgeOptimistic();
		this.scheduleRender();
	}

	// --- config ------------------------------------------------------------

	getDatePropertyId(): BasesPropertyId | null {
		return this.config?.getAsPropertyId(CONFIG_DATE_PROPERTY) ?? null;
	}

	getRange(): RangeMode {
		const value = this.config?.get(CONFIG_RANGE);
		return value === "day" || value === "week" ? value : "month";
	}

	getWeekStart(): WeekStart {
		return this.config?.get(CONFIG_WEEK_START) === "sunday" ? 0 : 1;
	}

	getOpenBehavior(): OpenBehavior {
		return this.plugin.settings.openBehavior;
	}

	/** Open a note the way the "Open notes in" setting says. */
	openInBehavior(file: TFile): void {
		switch (this.getOpenBehavior()) {
			case "tab":
				void this.app.workspace.getLeaf("tab").openFile(file);
				break;
			case "split":
				if (!this.detailLeaf || !this.isLeafAttached(this.detailLeaf)) {
					this.detailLeaf = this.app.workspace.getLeaf("split", "vertical");
				}
				void this.detailLeaf.openFile(file);
				break;
			case "active":
				void this.app.workspace.getLeaf(false).openFile(file);
				break;
			default:
				new NoteModal(this.app, file).open();
		}
	}

	getShowTime(): boolean {
		return this.config?.get(CONFIG_SHOW_TIME) !== false;
	}

	getShowWeekends(): boolean {
		return this.config?.get(CONFIG_SHOW_WEEKENDS) !== false;
	}

	private isDayVisible(day: Date): boolean {
		return this.getShowWeekends() || !isWeekend(day);
	}

	/**
	 * Only frontmatter properties can be written back, so a calendar built on
	 * `file.ctime` or a formula is read-only rather than broken.
	 */
	isEditable(): boolean {
		const propId = this.getDatePropertyId();
		return propId !== null && parsePropertyId(propId).type === "note";
	}

	/** A leaf the user closed is still a live object, so check before reusing it. */
	isLeafAttached(leaf: WorkspaceLeaf): boolean {
		let attached = false;
		this.app.workspace.iterateAllLeaves((candidate) => {
			if (candidate === leaf) attached = true;
		});
		return attached;
	}

	// --- toolbar -----------------------------------------------------------

	private buildToolbar(toolbarEl: HTMLElement): void {
		const navEl = toolbarEl.createDiv({ cls: "yabacavi-nav" });
		this.iconButton(navEl, "lucide-chevron-left", "Previous", () => this.shift(-1));
		const todayEl = navEl.createEl("button", { cls: "yabacavi-btn", text: "Today" });
		todayEl.addEventListener("click", () => {
			this.anchor = startOfDay(new Date());
			this.render();
		});
		this.iconButton(navEl, "lucide-chevron-right", "Next", () => this.shift(1));

		this.titleEl = toolbarEl.createDiv({ cls: "yabacavi-title" });

		this.modesEl = toolbarEl.createDiv({ cls: "yabacavi-modes" });
		for (const mode of RANGES) {
			const btnEl = this.modesEl.createEl("button", {
				cls: "yabacavi-btn",
				text: mode.charAt(0).toUpperCase() + mode.slice(1),
			});
			btnEl.dataset.mode = mode;
			btnEl.addEventListener("click", () => this.setRange(mode));
		}
	}

	private iconButton(
		parentEl: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void,
	): void {
		const btnEl = parentEl.createEl("button", { cls: "yabacavi-btn yabacavi-btn--icon" });
		setIcon(btnEl, icon);
		btnEl.setAttr("aria-label", label);
		btnEl.addEventListener("click", onClick);
	}

	private setRange(mode: RangeMode): void {
		// Persisted into the .base, so the toolbar and the view options stay in sync.
		this.config?.set(CONFIG_RANGE, mode);
		this.render();
	}

	private shift(direction: number): void {
		const range = this.getRange();
		if (range === "month") {
			this.anchor = addMonths(this.anchor, direction);
		} else if (range === "week") {
			this.anchor = addDays(this.anchor, 7 * direction);
		} else {
			// Stepping day by day with weekends hidden should skip over them
			// rather than land on a day the other ranges refuse to show.
			let next = addDays(this.anchor, direction);
			while (!this.isDayVisible(next)) next = addDays(next, direction);
			this.anchor = next;
		}
		this.render();
	}

	private updateToolbar(range: RangeMode, days: Date[]): void {
		for (const btnEl of Array.from(this.modesEl.children) as HTMLElement[]) {
			btnEl.toggleClass("is-active", btnEl.dataset.mode === range);
		}

		if (range === "month") {
			this.titleEl.setText(monthTitleFormat.format(this.anchor));
		} else if (range === "week") {
			const first = days[0];
			const last = days[days.length - 1];
			this.titleEl.setText(
				`${weekTitleFormat.format(first)} – ${weekTitleFormat.format(last)}, ${last.getFullYear()}`,
			);
		} else {
			this.titleEl.setText(dayTitleFormat.format(days[0]));
		}
	}

	// --- data --------------------------------------------------------------

	private findEntry(filePath: string): BasesEntry | null {
		for (const entry of this.data?.data ?? []) {
			if (entry.file.path === filePath) return entry;
		}
		return null;
	}

	private acknowledgeOptimistic(): void {
		if (this.optimistic.size === 0) return;

		const propId = this.getDatePropertyId();
		if (!propId) {
			this.optimistic.clear();
			return;
		}

		const entries = this.data?.data ?? [];
		const known = new Set(entries.map((entry) => entry.file.path));

		for (const [filePath, expected] of this.optimistic) {
			// The note dropped out of the query (a filter excluded it after the
			// move). Nothing left to reconcile against.
			if (!known.has(filePath)) {
				this.optimistic.delete(filePath);
				continue;
			}
			const entry = this.findEntry(filePath);
			const actual = entry ? extractDate(entry, propId) : null;
			if (actual && toDayKey(actual) === expected) this.optimistic.delete(filePath);
		}
	}

	private async moveCard(filePath: string, dayKey: DayKey): Promise<void> {
		const propId = this.getDatePropertyId();
		if (!propId || parsePropertyId(propId).type !== "note") {
			new Notice("Yabacavi: only note properties can be rescheduled.");
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return;

		const entry = this.findEntry(filePath);
		const current = entry ? extractDate(entry, propId) : null;
		if (current && toDayKey(current) === dayKey && !this.optimistic.has(filePath)) return;

		// Paint the move before awaiting the write, otherwise the card visibly
		// snaps back to its old cell until Bases reindexes.
		this.optimistic.set(filePath, dayKey);
		this.render();

		this.isWriting = true;
		const propName = parsePropertyId(propId).name;
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
				frontmatter[propName] = composeDateValue(frontmatter[propName], dayKey);
			});
		} catch (err) {
			this.optimistic.delete(filePath);
			console.error("Yabacavi: failed to reschedule", filePath, err);
			new Notice(`Yabacavi: couldn't reschedule ${file.basename}`);
		} finally {
			this.isWriting = false;
			if (this.pendingData) {
				this.pendingData = false;
				this.acknowledgeOptimistic();
			}
			this.scheduleRender();
		}
	}

	private visibleDays(range: RangeMode, weekStart: WeekStart): Date[] {
		// Day range shows whatever day you navigated to, weekend or not.
		if (range === "day") return [startOfDay(this.anchor)];

		if (range === "week") {
			const first = startOfWeek(this.anchor, weekStart);
			return Array.from({ length: 7 }, (_, i) => addDays(first, i)).filter((day) =>
				this.isDayVisible(day),
			);
		}

		const firstOfMonth = new Date(this.anchor.getFullYear(), this.anchor.getMonth(), 1);
		const lastOfMonth = new Date(this.anchor.getFullYear(), this.anchor.getMonth() + 1, 0);
		const first = startOfWeek(firstOfMonth, weekStart);
		const last = addDays(startOfWeek(lastOfMonth, weekStart), 6);

		const days: Date[] = [];
		for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
		// Filtering whole weeks leaves exactly 5 per row, still in order, so the
		// 5-column grid stays aligned.
		return days.filter((day) => this.isDayVisible(day));
	}

	private bucketEntries(propId: BasesPropertyId, days: Date[]): Map<DayKey, CardItem[]> {
		const buckets = new Map<DayKey, CardItem[]>();
		for (const day of days) buckets.set(toDayKey(day), []);

		// data.data arrives with the base's own sort applied — preserve that order.
		for (const entry of this.data?.data ?? []) {
			const actual = extractDate(entry, propId);
			const pending = this.optimistic.get(entry.file.path);

			let date = actual;
			if (pending) {
				date = parseDayKey(pending);
				if (actual) date.setHours(actual.getHours(), actual.getMinutes(), actual.getSeconds());
			}
			if (!date) continue;

			// Days outside the visible range have no bucket; those entries drop out.
			buckets.get(toDayKey(date))?.push({ entry, date });
		}
		return buckets;
	}

	// --- render ------------------------------------------------------------

	private scheduleRender(): void {
		if (this.renderTimer !== null) return;
		this.renderTimer = window.setTimeout(() => {
			this.renderTimer = null;
			this.render();
		}, RENDER_DEBOUNCE_MS);
	}

	private render(): void {
		const range = this.getRange();
		const weekStart = this.getWeekStart();
		const days = this.visibleDays(range, weekStart);

		this.updateToolbar(range, days);

		const scrollTop = this.bodyEl.scrollTop;
		this.bodyEl.empty();

		const propId = this.getDatePropertyId();
		if (!propId) {
			this.bodyEl.createDiv({
				cls: "yabacavi-empty",
				text: "Choose a date property in the view options to place notes on the calendar.",
			});
			return;
		}

		const buckets = this.bucketEntries(propId, days);
		this.rootEl.toggleClass("is-readonly", !this.isEditable());

		if (range === "month") this.renderMonth(days, buckets, weekStart);
		else if (range === "week") this.renderWeek(days, buckets);
		else this.renderDay(days[0], buckets);

		this.bodyEl.scrollTop = scrollTop;
	}

	private renderMonth(days: Date[], buckets: Map<DayKey, CardItem[]>, weekStart: WeekStart): void {
		const monthEl = this.bodyEl.createDiv({ cls: "yabacavi-month" });
		const weekdaysOnly = !this.getShowWeekends();

		const headerEl = monthEl.createDiv({ cls: "yabacavi-weekdays" });
		headerEl.toggleClass("is-weekdays-only", weekdaysOnly);

		// The header names weekdays, not dates, so marking today's column only
		// means something when today is actually on screen. Highlighting "Fri"
		// while browsing December would point at nothing.
		const today = new Date();
		const todayKey = toDayKey(today);
		const gridHasToday = days.some((day) => toDayKey(day) === todayKey);

		const weekRef = startOfWeek(this.anchor, weekStart);
		for (let i = 0; i < 7; i++) {
			const day = addDays(weekRef, i);
			if (!this.isDayVisible(day)) continue;
			const weekdayEl = headerEl.createDiv({
				cls: "yabacavi-weekday",
				text: weekdayFormat.format(day),
			});
			weekdayEl.toggleClass("is-today", gridHasToday && day.getDay() === today.getDay());
		}

		const gridEl = monthEl.createDiv({ cls: "yabacavi-grid yabacavi-grid--month" });
		gridEl.toggleClass("is-weekdays-only", weekdaysOnly);
		const month = this.anchor.getMonth();
		for (const day of days) {
			const cellEl = this.renderDayCell(gridEl, day, buckets, "number");
			if (day.getMonth() !== month) cellEl.addClass("is-outside");
		}
	}

	private renderWeek(days: Date[], buckets: Map<DayKey, CardItem[]>): void {
		const gridEl = this.bodyEl.createDiv({ cls: "yabacavi-grid yabacavi-grid--week" });
		gridEl.toggleClass("is-weekdays-only", !this.getShowWeekends());
		for (const day of days) this.renderDayCell(gridEl, day, buckets, "weekday");
	}

	private renderDay(day: Date, buckets: Map<DayKey, CardItem[]>): void {
		const gridEl = this.bodyEl.createDiv({ cls: "yabacavi-grid yabacavi-grid--day" });
		this.renderDayCell(gridEl, day, buckets, "none");
	}

	private renderDayCell(
		parentEl: HTMLElement,
		day: Date,
		buckets: Map<DayKey, CardItem[]>,
		head: "number" | "weekday" | "none",
	): HTMLElement {
		const dayKey = toDayKey(day);
		const cellEl = parentEl.createDiv({ cls: "yabacavi-day" });
		cellEl.dataset.dayKey = dayKey;
		if (isSameDay(day, new Date())) cellEl.addClass("is-today");

		if (head !== "none") {
			const headEl = cellEl.createDiv({ cls: "yabacavi-day-head" });
			if (head === "weekday") {
				headEl.createSpan({ cls: "yabacavi-day-weekday", text: weekdayFormat.format(day) });
			}
			headEl.createSpan({ cls: "yabacavi-day-number", text: String(day.getDate()) });
			if (this.plugin.settings.showDailyNote) this.renderDailyNoteButton(headEl, day);
		}

		const cardsEl = cellEl.createDiv({ cls: "yabacavi-day-cards" });
		for (const item of buckets.get(dayKey) ?? []) {
			renderCard(this, item.entry, item.date, cardsEl);
		}

		cellEl.addEventListener("dblclick", (evt) => {
			const target = evt.target as HTMLElement;
			if (target.closest(".yabacavi-card, .yabacavi-daily-note")) return;
			void this.createNoteOn(day);
		});

		return cellEl;
	}

	/**
	 * Icon in the day header for that day's daily note. Pinned visible when the
	 * note exists (the icon itself signals "has note"); CSS reveals it on hover
	 * otherwise.
	 */
	private renderDailyNoteButton(headEl: HTMLElement, day: Date): void {
		const existing = getDailyNote(this.app, day);
		// A span, not a button: a <button> drags the theme's background and focus
		// ring in with it, and this is meant to read as a bare icon.
		const btnEl = headEl.createSpan({ cls: "yabacavi-daily-note" });
		btnEl.toggleClass("has-note", existing !== null);
		setIcon(btnEl, existing ? "lucide-notebook-text" : "lucide-notebook-pen");
		btnEl.setAttr("aria-label", existing ? "Open daily note" : "Create daily note");
		btnEl.addEventListener("click", (evt) => {
			// Keep the click off the cell so it can't be mistaken for a card drag
			// or the double-click new-note gesture.
			evt.stopPropagation();
			void this.openDailyNote(day);
		});
	}

	private async openDailyNote(day: Date): Promise<void> {
		try {
			const file = getDailyNote(this.app, day) ?? (await createDailyNote(this.app, day));
			this.openInBehavior(file);
		} catch (err) {
			console.error("Yabacavi: failed to open the daily note", err);
			new Notice("Yabacavi: couldn't open the daily note");
		}
	}

	private async createNoteOn(day: Date): Promise<void> {
		const propId = this.getDatePropertyId();
		if (!propId || parsePropertyId(propId).type !== "note") return;
		const propName = parsePropertyId(propId).name;

		let body = "";
		const templatePath = this.plugin.settings.newNoteTemplate.trim();
		if (templatePath) {
			const template = this.app.vault.getAbstractFileByPath(templatePath);
			if (template instanceof TFile) body = await this.app.vault.cachedRead(template);
			else new Notice(`Yabacavi: template not found — ${templatePath}`);
		}

		// Self-create (rather than Bases' native flow) so the new note opens the
		// same way an existing card does — e.g. in the modal.
		const parent = this.app.fileManager.getNewFileParent("");
		const path = this.availableNotePath(parent.path, "Untitled");
		const file = await this.app.vault.create(path, body);
		await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			frontmatter[propName] = toDayKey(day);
		});
		this.openInBehavior(file);
	}

	private availableNotePath(folder: string, base: string): string {
		const dir = folder && folder !== "/" ? `${folder}/` : "";
		let path = `${dir}${base}.md`;
		let n = 1;
		while (this.app.vault.getAbstractFileByPath(path)) {
			path = `${dir}${base} ${n++}.md`;
		}
		return path;
	}
}
