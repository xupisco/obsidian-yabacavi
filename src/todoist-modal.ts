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
		checkbox.setAttr("aria-label", "Mark as done");
		checkbox.addEventListener("change", () => void this.complete(checkbox));
		this.titleEl.createSpan({ text: task.content });

		const { contentEl } = this;
		contentEl.empty();

		if (task.description.trim()) {
			// Todoist descriptions are markdown — render them so links (including the
			// obsidian:// links people paste back in) are live, not raw text.
			const descEl = contentEl.createDiv({ cls: "yabacavi-todoist-desc markdown-rendered" });
			this.renderChild.load();
			void MarkdownRenderer.render(this.app, task.description, descEl, "", this.renderChild);
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
