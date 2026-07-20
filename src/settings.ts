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

/** How a note's status colour is shown on its card. */
export type AccentStyle = "bar" | "bullet" | "none";

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
	/** How a note's status colour appears on its card: bar, bullet, or nothing. */
	accentStyle: AccentStyle;
	/** Thickness in px of the card accent bar (0 hides it). */
	accentHeight: number;
	/** Card title size, as a percentage of the adaptive default (100 = unchanged). */
	titleScale: number;
	/** Card time size, as a percentage of the adaptive default. */
	timeScale: number;
	/** Property-pill size, as a percentage of the adaptive default. */
	pillScale: number;
	/** Place Todoist tasks on the calendar by their due date. */
	todoistEnabled: boolean;
	/** ID of the entry in Obsidian's secret storage holding the API token — not
	 *  the token itself, which never touches this settings file. */
	todoistTokenSecret: string;
	/** Optional Todoist filter query limiting which tasks are fetched. Empty = all. */
	todoistFilter: string;
	/** Also place completed Todoist tasks on the calendar, styled as `done`. */
	todoistShowCompleted: boolean;
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
	accentStyle: "bar",
	accentHeight: 4,
	titleScale: 100,
	timeScale: 100,
	pillScale: 100,
	todoistEnabled: false,
	todoistTokenSecret: "",
	todoistFilter: "",
	todoistShowCompleted: false,
	todoistRefreshMinutes: 0,
	todoistAccentColor: "",
	statusProperty: "status",
	statusColors: [],
};

/**
 * Split a stored accent colour into the 6-digit hex the native picker needs and a
 * 0–100 opacity for the slider. Accepts `#RRGGBB` or `#RRGGBBAA`; anything else
 * falls back to an opaque grey.
 */
function splitColor(color: string): { hex: string; opacity: number } {
	const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec((color ?? "").trim());
	if (!match) return { hex: "#888888", opacity: 100 };
	return {
		hex: `#${match[1]}`,
		opacity: match[2] ? Math.round((parseInt(match[2], 16) / 255) * 100) : 100,
	};
}

/** Recombine a 6-digit hex and 0–100 opacity into `#RRGGBB` (opaque) or
 *  `#RRGGBBAA`. Kept 6-digit at full opacity so the common case stays clean. */
function combineColor(hex: string, opacity: number): string {
	if (opacity >= 100) return hex;
	const alpha = Math.round((opacity / 100) * 255)
		.toString(16)
		.padStart(2, "0");
	return `${hex}${alpha}`;
}

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

		this.displayAppearance(containerEl);

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
					picker.setValue(splitColor(statusColor.color).hex).onChange((value) => {
						statusColor.color = combineColor(value, splitColor(statusColor.color).opacity);
						void this.plugin.saveSettings();
					}),
				)
				.addSlider((slider) =>
					slider
						.setLimits(0, 100, 5)
						.setValue(splitColor(statusColor.color).opacity)
						.onChange((value) => {
							statusColor.color = combineColor(splitColor(statusColor.color).hex, value);
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

	private displayAppearance(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Appearance").setHeading();

		new Setting(containerEl)
			.setName("Status display")
			.setDesc("How a note's status colour shows on its card — a bar, a bullet before the title, or nothing.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("bar", "Accent bar")
					.addOption("bullet", "Accent bullet")
					.addOption("none", "None")
					.setValue(this.plugin.settings.accentStyle)
					.onChange((value) => {
						this.plugin.settings.accentStyle = value as AccentStyle;
						void this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Accent bar thickness")
			.setDesc("Height in pixels of the coloured bar across the top of each card. Set to 0 to hide it.")
			.addSlider((slider) =>
				slider
					.setLimits(0, 10, 1)
					.setValue(this.plugin.settings.accentHeight)
					.onChange((value) => {
						this.plugin.settings.accentHeight = value;
						void this.plugin.saveSettings();
					}),
			);

		this.fontScaleSetting(
			containerEl,
			"Title size",
			"Card title size, as a percentage of the default.",
			() => this.plugin.settings.titleScale,
			(value) => {
				this.plugin.settings.titleScale = value;
			},
		);
		this.fontScaleSetting(
			containerEl,
			"Time size",
			"Card time size, as a percentage of the default.",
			() => this.plugin.settings.timeScale,
			(value) => {
				this.plugin.settings.timeScale = value;
			},
		);
		this.fontScaleSetting(
			containerEl,
			"Pill size",
			"Property-pill size, as a percentage of the default.",
			() => this.plugin.settings.pillScale,
			(value) => {
				this.plugin.settings.pillScale = value;
			},
		);

	}

	/** A 70–150% slider bound to one of the card font-scale settings. */
	private fontScaleSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		get: () => number,
		set: (value: number) => void,
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addSlider((slider) =>
				slider
					.setLimits(70, 150, 5)
					.setValue(get())
					.onChange((value) => {
						set(value);
						void this.plugin.saveSettings();
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
			.setName("Filter")
			.setDesc(
				"Optional Todoist filter query, using the same syntax as Todoist's own filters (for example: #Work | #Personal). Leave empty to show all tasks with a due date.",
			)
			.addText((text) => {
				text
					.setPlaceholder("#Work | #Personal")
					.setValue(this.plugin.settings.todoistFilter)
					.onChange((value) => {
						this.plugin.settings.todoistFilter = value.trim();
						void this.plugin.saveSettings();
					});
				// Re-fetch when the field loses focus, not on every keystroke — otherwise
				// we'd hammer the API and fire half-typed, invalid queries as you type.
				text.inputEl.addEventListener("blur", () => this.plugin.configureTodoist());
			});

		const completedSetting = new Setting(containerEl)
			.setName("Show completed tasks")
			.setDesc(
				'Also place completed tasks on their due day, styled like a note with status "done". Fetched per visible month and cached.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.todoistShowCompleted).onChange((value) => {
					this.plugin.settings.todoistShowCompleted = value;
					if (!value) this.plugin.todoist.clearCompleted();
					void this.plugin.saveSettings();
				}),
			);
		// Still leans on two API details being validated in the field, so flag it.
		completedSetting.nameEl.createSpan({ cls: "yabacavi-beta-badge", text: "Beta" });

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
			new Setting(containerEl)
				.setName("Accent colour")
				.setDesc("Colour and opacity of the accent bar.")
				.addColorPicker((picker) =>
					picker.setValue(splitColor(this.plugin.settings.todoistAccentColor).hex).onChange((value) => {
						this.plugin.settings.todoistAccentColor = combineColor(
							value,
							splitColor(this.plugin.settings.todoistAccentColor).opacity,
						);
						void this.plugin.saveSettings();
					}),
				)
				.addSlider((slider) =>
					slider
						.setLimits(0, 100, 5)
						.setValue(splitColor(this.plugin.settings.todoistAccentColor).opacity)
						.onChange((value) => {
							this.plugin.settings.todoistAccentColor = combineColor(
								splitColor(this.plugin.settings.todoistAccentColor).hex,
								value,
							);
							void this.plugin.saveSettings();
						}),
				);
		}
	}
}
