import { requestUrl } from "obsidian";
import { parseDayKey, toDayKey, type DayKey } from "./date-utils";

// Todoist's REST v2 API (rest/v2) was sunset — it now answers 410. The unified
// v1 API replaces it, with cursor-paginated list endpoints.
const TASKS_URL = "https://api.todoist.com/api/v1/tasks";
// A filter query has its own endpoint — the plain /tasks list no longer accepts a
// `filter` param. Same paginated envelope, task shape unchanged.
const TASKS_FILTER_URL = "https://api.todoist.com/api/v1/tasks/filter";
const PROJECTS_URL = "https://api.todoist.com/api/v1/projects";

/** The `due` object of a Todoist task. In the v1 API the time (when any) rides
 *  on `date` itself, so `date` may be a bare day or a full timestamp. */
export interface TodoistDue {
	/** `YYYY-MM-DD` (all day), or a timestamp with a floating/zoned time. */
	date: string;
	/** UTC instant — only the older REST v2 shape sent this; kept for safety. */
	datetime?: string;
	/** The human phrase the user typed, e.g. "every monday". */
	string?: string;
	is_recurring?: boolean;
}

/** A Todoist task, trimmed to the fields a card needs. `labels` are names (not
 *  IDs); `project_id` needs the projects list to resolve to a name. */
export interface TodoistTask {
	id: string;
	content: string;
	description: string;
	project_id: string;
	labels: string[];
	/** 1 (normal) … 4 (urgent). The API inverts the UI's p1–p4 labels. */
	priority: number;
	due: TodoistDue | null;
	/** Web URL to the task. The v1 API omits it, so it may be absent — build one
	 *  from the id with {@link taskUrl} rather than reading this directly. */
	url?: string;
}

/** The task's page in the Todoist web/app, whether or not the API sent a `url`. */
export function taskUrl(task: TodoistTask): string {
	return task.url ?? `https://app.todoist.com/app/task/${task.id}`;
}

/** Within a day: timed tasks first in chronological order, then undated ones
 *  alphabetically by title. Shared by the fetch and the optimistic move. */
function compareTaskViews(a: TodoistTaskView, b: TodoistTaskView): number {
	if (a.hasTime !== b.hasTime) return a.hasTime ? -1 : 1;
	if (a.hasTime) return a.date.getTime() - b.date.getTime();
	return a.task.content.localeCompare(b.task.content);
}

/** RFC3339 in UTC, no milliseconds — the shape Todoist's due_datetime wants. */
function toUtcRfc3339(date: Date): string {
	return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Move a task's due to `dayKey`, keeping its time of day when it has one.
 *  Sends due_date for an all-day task, due_datetime for a timed one. */
export async function rescheduleTask(
	token: string,
	id: string,
	date: Date,
	hasTime: boolean,
): Promise<void> {
	const body = hasTime ? { due_datetime: toUtcRfc3339(date) } : { due_date: toDayKey(date) };
	await requestUrl({
		url: `${TASKS_URL}/${id}`,
		method: "POST",
		contentType: "application/json",
		headers: { Authorization: `Bearer ${token}` },
		body: JSON.stringify(body),
	});
}

/** Mark a task complete (Todoist's "close"). */
export async function completeTask(token: string, id: string): Promise<void> {
	await requestUrl({
		url: `${TASKS_URL}/${id}/close`,
		method: "POST",
		headers: { Authorization: `Bearer ${token}` },
	});
}

interface TodoistProject {
	id: string;
	name: string;
}

/** A task placed on the calendar: the raw task plus everything the card and
 *  modal display without re-deriving it. */
export interface TodoistTaskView {
	task: TodoistTask;
	/** The moment the task lands on, in local time. */
	date: Date;
	/** Whether the due carried a time — a date-only due is bare local midnight. */
	hasTime: boolean;
	/** Resolved from `project_id`; empty when the project can't be found. */
	projectName: string;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A local-clock timestamp with no zone marker — a "floating" due time. */
const FLOATING = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Turn a Todoist due into a local Date, coping with all three shapes the v1 API
 * emits: a bare day, a floating time (no zone — the user's wall clock), and a
 * zoned/UTC instant. A bare day becomes local midnight, matching how the
 * calendar reads date-only note properties, so both land on the same cell.
 */
function dueToDate(due: TodoistDue): { date: Date; hasTime: boolean } | null {
	const raw = due.datetime ?? due.date;
	if (!raw) return null;

	const dateOnly = DATE_ONLY.exec(raw);
	if (dateOnly) {
		return {
			date: new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])),
			hasTime: false,
		};
	}

	// Floating time: read the clock digits literally, in local time — a Date
	// parse of a zoneless string is implementation-defined, so don't rely on it.
	const floating = FLOATING.exec(raw);
	if (floating) {
		const [, y, m, d, hh, mm, ss] = floating;
		return {
			date: new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss ?? "0")),
			hasTime: true,
		};
	}

	// Anything left carries a zone (`Z` or an offset) — let the runtime localise.
	const zoned = new Date(raw);
	return Number.isNaN(zoned.getTime()) ? null : { date: zoned, hasTime: true };
}

/**
 * Holds the last fetched Todoist tasks, bucketed by the local day they're due.
 * One instance lives on the plugin and is shared by every calendar view, so a
 * single fetch feeds them all.
 */
export class TodoistStore {
	private byDay = new Map<DayKey, TodoistTaskView[]>();
	loading = false;
	error: string | null = null;

	tasksForDay(key: DayKey): TodoistTaskView[] {
		return this.byDay.get(key) ?? [];
	}

	clear(): void {
		this.byDay.clear();
		this.error = null;
	}

	/** Optimistically relocate a task to `dayKey`, keeping its time of day, and
	 *  return the moved view (with its new date) so the caller can push the write.
	 *  Null when the task isn't currently held. Reconciled by the next fetch. */
	moveTask(taskId: string, dayKey: DayKey): TodoistTaskView | null {
		const found = this.take(taskId);
		if (!found) return null;

		const date = parseDayKey(dayKey); // local midnight
		if (found.hasTime) {
			date.setHours(found.date.getHours(), found.date.getMinutes(), found.date.getSeconds());
		}
		found.date = date;

		const key = toDayKey(date);
		const list = this.byDay.get(key);
		if (list) {
			list.push(found);
			list.sort(compareTaskViews);
		} else {
			this.byDay.set(key, [found]);
		}
		return found;
	}

	/** Drop a task from the buckets (e.g. once completed), until the next fetch. */
	removeTask(taskId: string): void {
		this.take(taskId);
	}

	/** Find and detach a task from whichever day bucket holds it. */
	private take(taskId: string): TodoistTaskView | null {
		for (const [key, list] of this.byDay) {
			const idx = list.findIndex((view) => view.task.id === taskId);
			if (idx === -1) continue;
			const [found] = list.splice(idx, 1);
			if (list.length === 0) this.byDay.delete(key);
			return found;
		}
		return null;
	}

	/** Fetch tasks and projects, rebuild the day buckets, and return how many dated
	 *  tasks were placed. A non-empty `filter` restricts tasks to a Todoist filter
	 *  query. Throws on a network or auth failure, leaving the previous buckets in
	 *  place for the caller to decide whether to keep showing them. */
	async fetch(token: string, filter = ""): Promise<number> {
		this.loading = true;
		this.error = null;
		try {
			// A filter query goes to the dedicated /tasks/filter endpoint; empty means
			// the plain list of all active tasks.
			const trimmed = filter.trim();
			const tasksUrl = trimmed
				? `${TASKS_FILTER_URL}?query=${encodeURIComponent(trimmed)}`
				: TASKS_URL;
			const [tasks, projects] = await Promise.all([
				this.getAll<TodoistTask>(tasksUrl, token),
				this.getAll<TodoistProject>(PROJECTS_URL, token),
			]);

			const projectName = new Map(projects.map((p) => [p.id, p.name]));
			const byDay = new Map<DayKey, TodoistTaskView[]>();
			for (const task of tasks) {
				if (!task.due) continue;
				const parsed = dueToDate(task.due);
				if (!parsed) continue;

				const view: TodoistTaskView = {
					task,
					date: parsed.date,
					hasTime: parsed.hasTime,
					projectName: projectName.get(task.project_id) ?? "",
				};
				const key = toDayKey(parsed.date);
				const list = byDay.get(key);
				if (list) list.push(view);
				else byDay.set(key, [view]);
			}

			let count = 0;
			for (const list of byDay.values()) {
				list.sort(compareTaskViews);
				count += list.length;
			}
			this.byDay = byDay;
			return count;
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
			throw err;
		} finally {
			this.loading = false;
		}
	}

	/** GET every page of a v1 list endpoint. The API answers either a bare array
	 *  or a `{ results, next_cursor }` page; follow the cursor until it runs out. */
	private async getAll<T>(url: string, token: string): Promise<T[]> {
		const items: T[] = [];
		let cursor: string | null = null;

		do {
			// The url may already carry a query string (the filter endpoint), so pick
			// the right separator before appending the cursor.
			const sep = url.includes("?") ? "&" : "?";
			const full = cursor ? `${url}${sep}cursor=${encodeURIComponent(cursor)}` : url;
			const res = await requestUrl({ url: full, headers: { Authorization: `Bearer ${token}` } });
			const body = res.json as T[] | { results?: T[]; next_cursor?: string | null };

			if (Array.isArray(body)) {
				items.push(...body);
				cursor = null;
			} else {
				if (body.results) items.push(...body.results);
				cursor = body.next_cursor ?? null;
			}
		} while (cursor);

		return items;
	}
}
