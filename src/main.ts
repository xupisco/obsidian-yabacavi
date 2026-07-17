import { Plugin, type QueryController } from "obsidian";
import { CalendarView, VIEW_ID } from "./calendar-view";
import { getViewOptions } from "./view-options";
import { DEFAULT_SETTINGS, YabacaviSettingTab, type YabacaviSettings } from "./settings";

export default class YabacaviPlugin extends Plugin {
	settings: YabacaviSettings = DEFAULT_SETTINGS;
	private views = new Set<CalendarView>();

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
}
