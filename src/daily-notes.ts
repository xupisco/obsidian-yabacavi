import { TFile, moment, normalizePath, type App } from "obsidian";

/**
 * Reading and creating the core "Daily notes" plugin's notes without scanning
 * the vault: a daily note's path is deterministic — folder + a moment-formatted
 * filename — so a single hashmap lookup (`getAbstractFileByPath`) answers "does
 * one exist for this day?" in O(1), no folder walk.
 *
 * The daily-notes config isn't exposed by the public API, so we reach it through
 * `app.internalPlugins`. That's undeclared surface (hence the casts) and it only
 * covers the *core* plugin, not the community "Periodic Notes" plugin. When the
 * config can't be read we fall back to Obsidian's own defaults so the feature
 * still works in a vanilla vault.
 */

const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";

interface DailyNotesConfig {
	folder: string;
	format: string;
	template: string;
}

interface InternalPluginInstance {
	options?: { folder?: string; format?: string; template?: string };
}

interface AppWithInternalPlugins {
	internalPlugins?: {
		getPluginById(id: string): { instance?: InternalPluginInstance } | null;
	};
}

function getConfig(app: App): DailyNotesConfig {
	const plugin = (app as unknown as AppWithInternalPlugins).internalPlugins?.getPluginById(
		"daily-notes",
	);
	const options = plugin?.instance?.options ?? {};
	return {
		folder: (options.folder ?? "").trim(),
		format: (options.format ?? "").trim() || DEFAULT_DATE_FORMAT,
		template: (options.template ?? "").trim(),
	};
}

/** The path a daily note for `day` would live at, whether or not it exists. */
function dailyNotePath(config: DailyNotesConfig, day: Date): string {
	const filename = moment(day).format(config.format);
	return normalizePath(config.folder ? `${config.folder}/${filename}.md` : `${filename}.md`);
}

/** The existing daily note for `day`, or null — one O(1) lookup, no scan. */
export function getDailyNote(app: App, day: Date): TFile | null {
	const file = app.vault.getAbstractFileByPath(dailyNotePath(getConfig(app), day));
	return file instanceof TFile ? file : null;
}

/**
 * Expand the subset of core daily-note template variables worth handling — a
 * template left with a literal `{{date}}` in it reads as broken. `date` tracks
 * the day the note is for; `time` tracks now, matching the core plugin.
 */
function applyTemplateVars(body: string, day: Date, titleFormat: string): string {
	const forDay = moment(day);
	const now = moment();
	return body
		.replace(/{{\s*title\s*}}/gi, () => forDay.format(titleFormat))
		.replace(/{{\s*date\s*:\s*([^}]+?)\s*}}/gi, (_m, fmt: string) => forDay.format(fmt))
		.replace(/{{\s*date\s*}}/gi, () => forDay.format(DEFAULT_DATE_FORMAT))
		.replace(/{{\s*time\s*:\s*([^}]+?)\s*}}/gi, (_m, fmt: string) => now.format(fmt))
		.replace(/{{\s*time\s*}}/gi, () => now.format("HH:mm"));
}

/** Create the daily note for `day`, applying the configured template. */
export async function createDailyNote(app: App, day: Date): Promise<TFile> {
	const config = getConfig(app);
	const path = dailyNotePath(config, day);

	let body = "";
	if (config.template) {
		const templatePath = normalizePath(
			config.template.endsWith(".md") ? config.template : `${config.template}.md`,
		);
		const templateFile = app.vault.getAbstractFileByPath(templatePath);
		if (templateFile instanceof TFile) {
			body = applyTemplateVars(await app.vault.cachedRead(templateFile), day, config.format);
		}
	}

	const slash = path.lastIndexOf("/");
	if (slash > 0) {
		const parent = path.slice(0, slash);
		if (!app.vault.getAbstractFileByPath(parent)) await app.vault.createFolder(parent);
	}
	return app.vault.create(path, body);
}
