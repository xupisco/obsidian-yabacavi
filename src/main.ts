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

		this.configureTodoist();
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

		this.refreshViews(); // reflect the loading state on the button
		try {
			const count = await this.todoist.fetch(token);
			if (notify) new Notice(`Todoist: synced ${count} task${count === 1 ? "" : "s"}.`);
		} catch (err) {
			console.error("Yabacavi: failed to fetch Todoist tasks", err);
			new Notice("Yabacavi: couldn't fetch Todoist tasks — check the API token.");
		}
		this.refreshViews();
	}
}
