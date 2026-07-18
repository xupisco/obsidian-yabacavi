import {
	AbstractInputSuggest,
	PluginSettingTab,
	SecretComponent,
	Setting,
	TFile,
	requireApiVersion,
	type App,
} from "obsidian";
import type YabacaviPlugin from "./main";
import type { OpenBehavior } from "./view-options";

export interface StatusColor {
	value: string;
	color: string;
}

export interface YabacaviSettings {
	/** How clicking a card, or creating a note, opens it. */
	openBehavior: OpenBehavior;
	/** Vault path to a template file, applied when creating a note from a day. */
	newNoteTemplate: string;
	/** Show a per-day icon that opens (or creates) that day's daily note. */
	showDailyNote: boolean;
	/** Place Todoist tasks on the calendar by their due date. */
	todoistEnabled: boolean;
	/** ID of the entry in Obsidian's secret storage holding the API token — not
	 *  the token itself, which never touches this settings file. */
	todoistTokenSecret: string;
	/** Auto re-fetch interval in minutes; 0 means manual (toolbar button) only. */
	todoistRefreshMinutes: number;
	/** Accent-bar colour for every Todoist card. Empty means tint by priority. */
	todoistAccentColor: string;
	/** Frontmatter property whose value selects an accent colour. */
	statusProperty: string;
	statusColors: StatusColor[];
}

export const DEFAULT_SETTINGS: YabacaviSettings = {
	openBehavior: "modal",
	newNoteTemplate: "",
	showDailyNote: false,
	todoistEnabled: false,
	todoistTokenSecret: "",
	todoistRefreshMinutes: 0,
	todoistAccentColor: "",
	statusProperty: "status",
	statusColors: [],
};

/** Autocomplete of markdown files for the template picker. */
class FileSuggest extends AbstractInputSuggest<TFile> {
	private onPick: (path: string) => void;

	constructor(app: App, inputEl: HTMLInputElement, onPick: (path: string) => void) {
		super(app, inputEl);
		this.onPick = onPick;
	}

	getSuggestions(query: string): TFile[] {
		const q = query.toLowerCase();
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => file.path.toLowerCase().includes(q))
			.slice(0, 20);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile): void {
		this.setValue(file.path);
		this.onPick(file.path);
		this.close();
	}
}

export class YabacaviSettingTab extends PluginSettingTab {
	private plugin: YabacaviPlugin;

	constructor(app: App, plugin: YabacaviPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Open notes in")
			.setDesc("How clicking a card, or creating a note, opens it.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("modal", "Floating modal")
					.addOption("active", "Current tab")
					.addOption("tab", "New tab")
					.addOption("split", "Split right")
					.setValue(this.plugin.settings.openBehavior)
					.onChange((value) => {
						this.plugin.settings.openBehavior = value as OpenBehavior;
						void this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Show daily note")
			.setDesc(
				"Add an icon on each day's number that opens its daily note, or creates one (using your daily notes folder, format and template) when there isn't one yet.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showDailyNote).onChange((value) => {
					this.plugin.settings.showDailyNote = value;
					void this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("New note template")
			.setDesc(
				"Template file used when creating a note by double-clicking a day. Copied verbatim; template variables aren't expanded.",
			)
			.addSearch((search) => {
				new FileSuggest(this.app, search.inputEl, (path) => {
					this.plugin.settings.newNoteTemplate = path;
					void this.plugin.saveSettings();
				});
				search
					.setPlaceholder("Templates/Task.md")
					.setValue(this.plugin.settings.newNoteTemplate)
					.onChange((value) => {
						this.plugin.settings.newNoteTemplate = value.trim();
						void this.plugin.saveSettings();
					});
			});

		this.displayTodoist(containerEl);

		new Setting(containerEl)
			.setName("Status property")
			.setDesc("Frontmatter property whose value picks the accent colour below.")
			.addText((text) =>
				text
					.setPlaceholder("status")
					.setValue(this.plugin.settings.statusProperty)
					.onChange((value) => {
						this.plugin.settings.statusProperty = value.trim() || "status";
						void this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Status colours").setHeading();

		this.plugin.settings.statusColors.forEach((statusColor, index) => {
			new Setting(containerEl)
				.addText((text) =>
					text
						.setPlaceholder("done")
						.setValue(statusColor.value)
						.onChange((value) => {
							statusColor.value = value.trim();
							void this.plugin.saveSettings();
						}),
				)
				.addColorPicker((picker) =>
					picker.setValue(statusColor.color || "#888888").onChange((value) => {
						statusColor.color = value;
						void this.plugin.saveSettings();
					}),
				)
				.addExtraButton((button) =>
					button
						.setIcon("trash-2")
						.setTooltip("Remove")
						.onClick(() => {
							this.plugin.settings.statusColors.splice(index, 1);
							void this.plugin.saveSettings();
							this.display();
						}),
				);
		});

		new Setting(containerEl).addButton((button) =>
			button
				.setButtonText("Add status colour")
				.setCta()
				.onClick(() => {
					this.plugin.settings.statusColors.push({ value: "", color: "#888888" });
					void this.plugin.saveSettings();
					this.display();
				}),
		);
	}

	private displayTodoist(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Todoist").setHeading();

		// SecretComponent and the secret store both landed in 1.11.4. On anything
		// older there's nowhere safe to keep a token, so the whole section is gated.
		if (!requireApiVersion("1.11.4")) {
			new Setting(containerEl).setDesc(
				"Todoist integration needs Obsidian 1.11.4 or newer (for secret storage).",
			);
			return;
		}

		new Setting(containerEl)
			.setName("API token")
			.setDesc(
				"Your Todoist API token (Settings → Integrations → Developer). Kept in Obsidian's secret storage, not in this plugin's settings file.",
			)
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(this.plugin.settings.todoistTokenSecret)
					.onChange((value) => {
						this.plugin.settings.todoistTokenSecret = value;
						void this.plugin.saveSettings();
						this.plugin.configureTodoist();
					}),
			);

		new Setting(containerEl)
			.setName("Show Todoist tasks")
			.setDesc("Place your Todoist tasks on the calendar by their due date, beside the note cards.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.todoistEnabled).onChange((value) => {
					this.plugin.settings.todoistEnabled = value;
					void this.plugin.saveSettings();
					this.plugin.configureTodoist();
				}),
			);

		new Setting(containerEl)
			.setName("Auto-refresh")
			.setDesc(
				"How often to re-fetch tasks from Todoist. Manual only relies on the refresh button in the calendar toolbar.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("0", "Manual only")
					.addOption("5", "Every 5 minutes")
					.addOption("15", "Every 15 minutes")
					.addOption("30", "Every 30 minutes")
					.addOption("60", "Every hour")
					.setValue(String(this.plugin.settings.todoistRefreshMinutes))
					.onChange((value) => {
						this.plugin.settings.todoistRefreshMinutes = Number(value);
						void this.plugin.saveSettings();
						this.plugin.configureTodoist();
					}),
			);

		// A toggle, not a bare picker: a colour picker always shows some swatch, so
		// on its own it can't represent "unset" and reads as already-applied. The
		// toggle makes the state explicit — off means tint by priority.
		new Setting(containerEl)
			.setName("Custom accent colour")
			.setDesc(
				"Give every Todoist card the same accent bar. Off tints them by task priority (p1 red … p3 blue).",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.todoistAccentColor !== "").onChange((value) => {
					this.plugin.settings.todoistAccentColor = value ? "#e44332" : "";
					void this.plugin.saveSettings();
					this.display();
				}),
			);

		if (this.plugin.settings.todoistAccentColor !== "") {
			new Setting(containerEl).setName("Accent colour").addColorPicker((picker) =>
				picker.setValue(this.plugin.settings.todoistAccentColor).onChange((value) => {
					this.plugin.settings.todoistAccentColor = value;
					void this.plugin.saveSettings();
				}),
			);
		}
	}
}
