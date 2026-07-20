import { Notice, Plugin, requireApiVersion, type QueryController } from "obsidian";
import { CalendarView, VIEW_ID } from "./calendar-view";
import { getViewOptions } from "./view-options";
import { DEFAULT_SETTINGS, YabacaviSettingTab, type YabacaviSettings } from "./settings";
import { TodoistStore } from "./todoist";

/** Secret storage arrived in 1.11.4; below it there's no token to read. */
const SECRET_API_VERSION = "1.11.4";

export default class YabacaviPlugin extends Plugin {
	settings: YabacaviSettings = DEFAULT_SETTINGS;
	readonly todoist = new TodoistStore();
	private views = new Set<CalendarView>();
	private todoistTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Cards emit "hover-link", so Page preview has to know this source exists.
		this.registerHoverLinkSource(VIEW_ID, { display: "Yabacavi", defaultMod: false });

		const registered = this.registerBasesView(VIEW_ID, {
			name: "Calendar cards",
			icon: "lucide-calendar-days",
			factory: (controller: QueryController, containerEl: HTMLElement) =>
				new CalendarView(controller, containerEl, this),
			options: () => getViewOptions(),
		});

		if (!registered) {
			console.error("Yabacavi: Bases is disabled in this vault, the calendar view was not registered.");
		}

		this.addSettingTab(new YabacaviSettingTab(this.app, this));

		this.registerCommands();
		this.configureTodoist();
	}

	/** Command-palette entries (also bindable to hotkeys). Each is gated so it only
	 *  shows when it's meaningful — no clutter for vaults not using Todoist. */
	private registerCommands(): void {
		this.addCommand({
			id: "refresh-todoist",
			name: "Refresh Todoist tasks",
			checkCallback: (checking: boolean) => {
				if (!this.isTodoistActive()) return false;
				if (!checking) void this.refreshTodoist(true);
				return true;
			},
		});

		this.addCommand({
			id: "toggle-todoist",
			name: "Toggle Todoist tasks",
			checkCallback: (checking: boolean) => {
				if (!this.isTodoistConfigured()) return false;
				if (!checking) void this.toggleTodoistEnabled();
				return true;
			},
		});

		this.addCommand({
			id: "toggle-todoist-completed",
			name: "Toggle completed Todoist tasks",
			checkCallback: (checking: boolean) => {
				if (!this.isTodoistConfigured()) return false;
				if (!checking) void this.toggleTodoistCompleted();
				return true;
			},
		});
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<YabacaviSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.refreshViews();
	}

	trackView(view: CalendarView): void {
		this.views.add(view);
	}

	untrackView(view: CalendarView): void {
		this.views.delete(view);
	}

	private refreshViews(): void {
		for (const view of this.views) view.refresh();
	}

	// --- Todoist -----------------------------------------------------------

	/** The API token from secret storage, or null when the feature is off, no
	 *  secret is chosen, or the app is too old to have a secret store. */
	getTodoistToken(): string | null {
		const id = this.settings.todoistTokenSecret;
		if (!id || !requireApiVersion(SECRET_API_VERSION)) return null;
		return this.app.secretStorage.getSecret(id);
	}

	/** True when a token is set up — used to decide whether to surface the Todoist
	 *  controls at all, without reading the secret itself on every render. */
	isTodoistConfigured(): boolean {
		return this.settings.todoistTokenSecret !== "" && requireApiVersion(SECRET_API_VERSION);
	}

	/** True when tasks should be fetched and drawn — used by the views to decide
	 *  whether to place task-cards and show the refresh button. */
	isTodoistActive(): boolean {
		return this.settings.todoistEnabled && this.getTodoistToken() !== null;
	}

	/** Ensure the completed tasks for the given months (`YYYY-MM`) are loaded, and
	 *  re-render if anything changed. The views call this for their visible range;
	 *  it no-ops unless Todoist is active and completed tasks are switched on. Each
	 *  month is TTL- and in-flight-guarded, so calling it every render is cheap. */
	async ensureCompletedMonths(monthKeys: string[]): Promise<void> {
		if (!this.isTodoistActive() || !this.settings.todoistShowCompleted) return;
		const token = this.getTodoistToken();
		if (!token) return;

		// Cache lifetime tracks the refresh cadence; when refresh is manual, a short
		// floor still keeps navigation from re-hitting the API on every move.
		const minutes = this.settings.todoistRefreshMinutes;
		const ttl = minutes > 0 ? minutes * 60_000 : 5 * 60_000;

		let changed = false;
		await Promise.all(
			monthKeys.map(async (monthKey) => {
				try {
					const didFetch = await this.todoist.ensureCompletedMonth(
						token,
						monthKey,
						this.settings.todoistFilter,
						ttl,
					);
					if (didFetch) changed = true;
				} catch (err) {
					console.error("Yabacavi: failed to fetch completed Todoist tasks", monthKey, err);
				}
			}),
		);
		if (changed) this.refreshViews();
	}

	/** Flip whether Todoist tasks are shown, and (re)start the fetch loop. Backs the
	 *  toolbar/settings toggle and the command. */
	async toggleTodoistEnabled(): Promise<void> {
		this.settings.todoistEnabled = !this.settings.todoistEnabled;
		await this.saveSettings();
		this.configureTodoist();
	}

	/** Flip whether completed tasks are shown; clears their cache when switching off.
	 *  A re-render (via saveSettings) then re-pulls the visible months when on. */
	async toggleTodoistCompleted(): Promise<void> {
		this.settings.todoistShowCompleted = !this.settings.todoistShowCompleted;
		if (!this.settings.todoistShowCompleted) this.todoist.clearCompleted();
		await this.saveSettings();
	}

	/** (Re)start the fetch loop from current settings: clear when off, otherwise
	 *  fetch once now and arm the timer if an interval is set. */
	configureTodoist(): void {
		if (this.todoistTimer !== null) {
			window.clearInterval(this.todoistTimer);
			this.todoistTimer = null;
		}

		if (!this.isTodoistActive()) {
			this.todoist.clear();
			this.refreshViews();
			return;
		}

		void this.refreshTodoist();

		const minutes = this.settings.todoistRefreshMinutes;
		if (minutes > 0) {
			this.todoistTimer = window.setInterval(() => void this.refreshTodoist(), minutes * 60_000);
			this.registerInterval(this.todoistTimer);
		}
	}

	/** Fetch tasks now (the toolbar button and the timer both land here) and
	 *  re-render. On failure the last tasks stay on screen. `notify` toasts the
	 *  result — on for the manual refresh, off for the silent auto-refresh. */
	async refreshTodoist(notify = false): Promise<void> {
		const token = this.getTodoistToken();
		if (!this.settings.todoistEnabled || !token) return;

		// fetch() flips todoist.loading true synchronously, before its first await,
		// so kick it off and only then re-render — rendering first would paint the
		// button with loading still false and the spinner would never show.
		const pending = this.todoist.fetch(token, this.settings.todoistFilter);
		// A refresh should re-pull completed tasks too; marking them stale makes the
		// next render (which re-runs ensureCompletedMonths) refetch the visible months.
		this.todoist.invalidateCompleted();
		this.refreshViews(); // reflect the loading state on the button
		try {
			const count = await pending;
			if (notify) new Notice(`Todoist: synced ${count} task${count === 1 ? "" : "s"}.`);
		} catch (err) {
			console.error("Yabacavi: failed to fetch Todoist tasks", err);
			new Notice("Yabacavi: couldn't fetch Todoist tasks — check the API token or filter.");
		}
		this.refreshViews();
	}
}
