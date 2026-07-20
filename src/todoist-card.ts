import { setIcon } from "obsidian";
import type { CalendarView } from "./calendar-view";
import type { TodoistTaskView } from "./todoist";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

/** The Todoist mark — a red rounded square with two white check-ticks — built as
 *  an inline SVG (not a lucide glyph) so it keeps its brand colours and reads at
 *  a glance as "this card came from Todoist". */
function renderTodoistMark(parentEl: HTMLElement): void {
	const svg = parentEl.createSvg("svg", {
		cls: "yabacavi-card-source",
		attr: { viewBox: "0 0 24 24" },
	});
	svg.createSvg("rect", { attr: { width: "24", height: "24", rx: "6", fill: "#e44332" } });
	const g = svg.createSvg("g", {
		attr: {
			fill: "none",
			stroke: "#fff",
			"stroke-width": "2",
			"stroke-linecap": "round",
			"stroke-linejoin": "round",
		},
	});
	g.createSvg("path", { attr: { d: "M6 9 l2.75 2.75 l6.25 -6.25" } });
	g.createSvg("path", { attr: { d: "M6 15.5 l2.75 2.75 l6.25 -6.25" } });
}

/**
 * A read-only Todoist task, rendered as a card beside the note cards. It reuses
 * the `.yabacavi-card` skeleton so styling stays shared, and carries
 * `data-source="todoist"` (plus `data-priority`) so a theme or snippet can pick
 * it out. Not draggable — rescheduling to Todoist is a later version.
 */
export function renderTodoistCard(
	view: CalendarView,
	item: TodoistTaskView,
	container: HTMLElement,
): HTMLElement {
	const { task, projectName, hasTime, date, completed } = item;

	const cardEl = container.createDiv({ cls: "yabacavi-card yabacavi-card--todoist" });
	cardEl.dataset.source = "todoist";
	cardEl.dataset.taskId = task.id;

	// Same accent-bar + body skeleton as a note card.
	const accentEl = cardEl.createDiv({ cls: "yabacavi-card-accent" });

	if (completed) {
		// Render like a vault note with status "done": carry data-status so the same
		// [data-status="done"] styling (theme/snippet) applies, and tint the accent
		// with the configured "done" colour, exactly as a note card does. Not
		// draggable, and no priority tint.
		cardEl.dataset.completed = "true";
		cardEl.dataset.status = "done";
		const doneColor = view.getStatusColor("done");
		if (doneColor) cardEl.style.setProperty("--yabacavi-accent-color", doneColor);
	} else {
		cardEl.dataset.priority = String(task.priority);
		// Recurring tasks aren't draggable — rescheduling one occurrence through the
		// API would drop the recurrence — so only mark the rest draggable.
		if (task.due?.is_recurring) cardEl.dataset.recurring = "true";
		else cardEl.setAttr("draggable", "true");
		// A configured accent is set inline on the bar so it beats the per-priority
		// CSS defaults without a cascade fight; left unset, those defaults show through.
		const accent = view.getTodoistAccentColor();
		if (accent) accentEl.style.backgroundColor = accent;
	}

	const bodyEl = cardEl.createDiv({ cls: "yabacavi-card-body" });

	const titleEl = bodyEl.createDiv({ cls: "yabacavi-card-title" });
	if (view.getShowTime() && hasTime) {
		titleEl.createSpan({ cls: "yabacavi-card-time", text: timeFormat.format(date) });
	}
	// Icon and text share a row so the marker reads like a task checkbox beside
	// the title, rather than stacking on its own line above it.
	const lineEl = titleEl.createDiv({ cls: "yabacavi-card-titleline" });
	renderTodoistMark(lineEl);
	lineEl.createSpan({ text: task.content });
	// A quiet marker that the task carries a description worth opening.
	if (task.description.trim()) {
		const descEl = lineEl.createSpan({
			cls: "yabacavi-card-desc-icon",
			attr: { "aria-label": "Has a description" },
		});
		setIcon(descEl, "lucide-align-left");
	}

	const rows: Array<{ property: string; items: string[] }> = [];
	if (projectName) rows.push({ property: "todoist.project", items: [projectName] });
	if (task.labels.length > 0) rows.push({ property: "todoist.tags", items: task.labels });

	if (rows.length > 0) {
		const propsEl = bodyEl.createDiv({ cls: "yabacavi-card-props" });
		for (const row of rows) {
			const chipEl = propsEl.createDiv({ cls: "yabacavi-chip" });
			chipEl.dataset.property = row.property;
			for (const value of row.items) {
				chipEl.createSpan({ cls: "yabacavi-chip-item", text: value });
			}
		}
	}

	cardEl.addEventListener("click", () => view.openTodoistTask(item));

	return cardEl;
}
