import { ButtonComponent, Component, MarkdownRenderer, Modal, Notice, setIcon } from "obsidian";
import { completeTask, taskUrl, type TodoistTask, type TodoistTaskView } from "./todoist";
import type YabacaviPlugin from "./main";

const fullDateFormat = new Intl.DateTimeFormat(undefined, {
	weekday: "long",
	day: "numeric",
	month: "long",
	year: "numeric",
});
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
	weekday: "long",
	day: "numeric",
	month: "long",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
});

/**
 * The note path or name carried by an `obsidian://` URI, or null if it isn't one
 * (or names no note). Covers the core `open?file=…`/`path=…` shape and the
 * Advanced URI plugin's `filepath=…`/`filename=…`. The vault is deliberately not
 * checked — resolving against the current vault covers the common case, and a
 * mismatch there was silently sending links back to window.open.
 */
function obsidianNoteTarget(href: string): string | null {
	if (!/^obsidian:\/\//i.test(href)) return null;
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return null;
	}
	const p = url.searchParams;
	return p.get("file") ?? p.get("path") ?? p.get("filepath") ?? p.get("filename");
}

/** Read-only detail view for a Todoist task: title, description, due, project
 *  and labels, plus a jump to the task in Todoist. */
export class TodoistTaskModal extends Modal {
	private plugin: YabacaviPlugin;
	private item: TodoistTaskView;
	/** Owns the lifecycle of the rendered description (its links, embeds, etc.). */
	private readonly renderChild = new Component();

	constructor(plugin: YabacaviPlugin, item: TodoistTaskView) {
		super(plugin.app);
		this.plugin = plugin;
		this.item = item;
	}

	onOpen(): void {
		const { task, date, hasTime } = this.item;
		this.modalEl.addClass("yabacavi-todoist-modal");

		// A Todoist-style round checkbox beside the title, to close the task.
		this.titleEl.empty();
		this.titleEl.addClass("yabacavi-todoist-title");
		const checkbox = this.titleEl.createEl("input", {
			type: "checkbox",
			cls: "yabacavi-todoist-check",
		});
		if (this.item.completed) {
			// Already done — show it ticked, and don't offer to complete it again.
			checkbox.checked = true;
			checkbox.disabled = true;
			checkbox.setAttr("aria-label", "Completed");
		} else {
			checkbox.setAttr("aria-label", "Mark as done");
			checkbox.addEventListener("change", () => void this.complete(checkbox));
		}
		this.titleEl.createSpan({ text: task.content });

		const { contentEl } = this;
		contentEl.empty();

		if (task.description.trim()) {
			// Todoist descriptions are markdown — render them so links (including the
			// obsidian:// links people paste back in) are live, not raw text.
			const descEl = contentEl.createDiv({ cls: "yabacavi-todoist-desc markdown-rendered" });
			this.renderChild.load();
			void MarkdownRenderer.render(this.app, task.description, descEl, "", this.renderChild);
			this.wireDescriptionLinks(descEl);
		}

		const metaEl = contentEl.createDiv({ cls: "yabacavi-todoist-meta" });

		const resolved = hasTime ? dateTimeFormat.format(date) : fullDateFormat.format(date);
		const recurring = task.due?.is_recurring ? task.due.string : null;
		this.metaRow(metaEl, "lucide-calendar", "Due", recurring ? `${resolved} · ${recurring}` : resolved);

		if (this.item.projectName) {
			this.metaRow(metaEl, "lucide-folder", "Project", this.item.projectName);
		}
		if (task.labels.length > 0) {
			this.metaRow(metaEl, "lucide-tag", "Labels", task.labels.join(", "));
		}

		new ButtonComponent(contentEl)
			.setButtonText("Open in Todoist")
			.setCta()
			.setClass("yabacavi-todoist-open")
			.onClick(() => {
				this.openInTodoist(task);
				this.close();
			});
	}

	/**
	 * Try the installed Todoist app, then fall back to the web task.
	 *
	 * There's no reliable "is the app installed?" probe, so this uses the standard
	 * trick: fire the `todoist://` deep link, and if the OS hands focus to the app
	 * (the window blurs) leave it there — otherwise, shortly after, open the web
	 * URL. On a machine without the app the deep link just no-ops (or, on Windows,
	 * may prompt once) and the web page opens instead.
	 */
	/** Close (complete) the task in Todoist, drop it from the calendar, and shut
	 *  the modal. On failure the tick is rolled back and the modal stays open. */
	private async complete(checkbox: HTMLInputElement): Promise<void> {
		const token = this.plugin.getTodoistToken();
		if (!token) {
			checkbox.checked = false;
			return;
		}

		checkbox.disabled = true;
		try {
			await completeTask(token, this.item.task.id);
			this.plugin.todoist.removeTask(this.item.task.id);
			new Notice(`Todoist: completed "${this.item.task.content}".`);
			this.close();
			void this.plugin.refreshTodoist();
		} catch (err) {
			console.error("Yabacavi: failed to complete Todoist task", err);
			new Notice("Yabacavi: couldn't complete the task.");
			checkbox.checked = false;
			checkbox.disabled = false;
		}
	}

	private openInTodoist(task: TodoistTask): void {
		const appUrl = `todoist://task?id=${task.id}`;
		const webUrl = taskUrl(task);

		let handedOff = false;
		const onBlur = () => {
			handedOff = true;
		};
		window.addEventListener("blur", onBlur, { once: true });

		window.open(appUrl);

		window.setTimeout(() => {
			window.removeEventListener("blur", onBlur);
			if (!handedOff) window.open(webUrl, "_blank");
		}, 700);
	}

	/**
	 * Make links in the rendered description open in a new tab. MarkdownRenderer
	 * wires no click handling here (empty source path, inside a modal), so route
	 * clicks ourselves — and crucially never let the default action navigate the
	 * calendar's own leaf. Internal links (wikilinks, and `obsidian://open` URIs
	 * into this vault) open in a new leaf and close the modal so the note shows;
	 * external URLs go to the browser.
	 *
	 * `obsidian://` links are the reason for the vault-target check: they render as
	 * plain external links, and letting `window.open` handle one makes Obsidian
	 * navigate the active (calendar) leaf instead of opening a new tab.
	 */
	private wireDescriptionLinks(descEl: HTMLElement): void {
		descEl.addEventListener(
			"click",
			(evt) => {
				const anchor = (evt.target as HTMLElement).closest("a");
				if (!anchor) return;
				const href = anchor.getAttribute("href") ?? "";

				// A wikilink, or an obsidian:// URI that names a note — open it in a new
				// leaf and close the modal so the note shows.
				const target = anchor.getAttribute("data-href") ?? obsidianNoteTarget(href);
				if (target) {
					evt.preventDefault();
					evt.stopPropagation();
					void this.app.workspace.openLinkText(target, "", true);
					this.close();
					return;
				}

				// Never let an obsidian:// link reach window.open — Obsidian would then
				// navigate the calendar's own leaf. Swallow it rather than hijack.
				if (/^obsidian:\/\//i.test(href)) {
					evt.preventDefault();
					evt.stopPropagation();
					return;
				}

				if (href) {
					evt.preventDefault();
					evt.stopPropagation();
					window.open(href, "_blank");
				}
			},
			// Capture phase, so we beat any Obsidian handler that would navigate first.
			true,
		);
	}

	private metaRow(parentEl: HTMLElement, icon: string, label: string, value: string): void {
		const rowEl = parentEl.createDiv({ cls: "yabacavi-todoist-row" });
		const iconEl = rowEl.createSpan({ cls: "yabacavi-todoist-row-icon" });
		setIcon(iconEl, icon);
		rowEl.createSpan({ cls: "yabacavi-todoist-row-label", text: label });
		rowEl.createSpan({ cls: "yabacavi-todoist-row-value", text: value });
	}

	onClose(): void {
		this.renderChild.unload();
		this.contentEl.empty();
	}
}
