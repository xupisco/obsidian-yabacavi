import { DateValue, NullValue, type BasesEntry, type BasesPropertyId, type Value } from "obsidian";

/** A local calendar day, `YYYY-MM-DD`. Used as the identity of a grid cell. */
export type DayKey = string;

export type WeekStart = 0 | 1;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Captures the offset too — dropping it would rewrite what zone the note meant. */
const TIME_PART = /[T ](\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)/;

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

/**
 * Always format against the local calendar. `toISOString()` would shift the day
 * for anyone west of UTC — a note due on the 17th lands on the 16th in UTC-3.
 */
export function toDayKey(date: Date): DayKey {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDayKey(key: DayKey): Date {
	const [y, m, d] = key.split("-").map(Number);
	return new Date(y, m - 1, d);
}

export function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

export function addMonths(date: Date, months: number): Date {
	// Anchor to the 1st before shifting: `new Date(2026, 0, 31)` + 1 month would
	// otherwise overflow March.
	return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export function startOfWeek(date: Date, weekStart: WeekStart): Date {
	const start = startOfDay(date);
	const diff = (start.getDay() - weekStart + 7) % 7;
	return addDays(start, -diff);
}

export function isSameDay(a: Date, b: Date): boolean {
	return toDayKey(a) === toDayKey(b);
}

export function isWeekend(date: Date): boolean {
	const day = date.getDay();
	return day === 0 || day === 6;
}

/** Parse a string that Bases handed us as text rather than a typed date. */
function parseLoose(input: string | null | undefined): Date | null {
	const trimmed = input?.trim();
	if (!trimmed) return null;

	// Date-only strings must be read as local midnight. `new Date("2026-07-17")`
	// is parsed as UTC by spec, which lands on the wrong day in UTC-3.
	const dateOnly = DATE_ONLY.exec(trimmed);
	if (dateOnly) {
		return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
	}

	const viaBases = DateValue.parseFromString(trimmed);
	const fromBases = viaBases ? unwrapDate(viaBases) : null;
	if (fromBases) return fromBases;

	const native = new Date(trimmed);
	return Number.isNaN(native.getTime()) ? null : native;
}

/**
 * Reach the JS Date behind a DateValue.
 *
 * `DateValue` exposes no getter for it in the public typings, but the field is
 * there at runtime. Guarded on both sides so a future API change degrades to the
 * string reparse below rather than throwing.
 */
function unwrapDate(value: DateValue): Date | null {
	const raw = (value as unknown as { date?: unknown }).date;
	if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
	return null;
}

export function valueToDate(value: Value | null): Date | null {
	if (!value || value instanceof NullValue || !value.isTruthy()) return null;
	if (value instanceof DateValue) {
		return unwrapDate(value) ?? parseLoose(value.toString());
	}
	return parseLoose(value.toString());
}

export function extractDate(entry: BasesEntry, propId: BasesPropertyId): Date | null {
	try {
		return valueToDate(entry.getValue(propId));
	} catch (err) {
		console.error(`Yabacavi: failed to read ${propId} from ${entry.file.path}`, err);
		return null;
	}
}

/** True when the date carries a meaningful time, i.e. it isn't bare local midnight. */
export function hasTime(date: Date): boolean {
	return date.getHours() !== 0 || date.getMinutes() !== 0 || date.getSeconds() !== 0;
}

/**
 * Build the new frontmatter value for a card dropped on `dayKey`, keeping
 * whatever time-of-day the note already had. Dragging a 14:30 meeting to the
 * next day should keep it at 14:30, not silently blank the time.
 */
export function composeDateValue(previous: unknown, dayKey: DayKey): string {
	let time: string | null = null;

	if (typeof previous === "string") {
		time = TIME_PART.exec(previous)?.[1] ?? null;
	} else if (previous instanceof Date && hasTime(previous)) {
		time = `${pad(previous.getHours())}:${pad(previous.getMinutes())}`;
	}

	return time ? `${dayKey}T${time}` : dayKey;
}
