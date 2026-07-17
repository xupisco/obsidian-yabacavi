import type { BasesAllOptions } from "obsidian";

export const CONFIG_DATE_PROPERTY = "dateProperty";
export const CONFIG_RANGE = "range";
export const CONFIG_WEEK_START = "weekStart";
export const CONFIG_SHOW_WEEKENDS = "showWeekends";
export const CONFIG_SHOW_TIME = "showTime";

export type RangeMode = "day" | "week" | "month";
export type OpenBehavior = "modal" | "active" | "tab" | "split";

export function getViewOptions(): BasesAllOptions[] {
	return [
		{
			type: "group" as const,
			displayName: "Calendar",
			items: [
				{
					key: CONFIG_DATE_PROPERTY,
					type: "property" as const,
					displayName: "Date property",
					placeholder: "Property",
				},
				{
					key: CONFIG_RANGE,
					type: "dropdown" as const,
					displayName: "Range",
					default: "month",
					options: { day: "Day", week: "Week", month: "Month" },
				},
				{
					key: CONFIG_WEEK_START,
					type: "dropdown" as const,
					displayName: "Week starts on",
					default: "monday",
					options: { sunday: "Sunday", monday: "Monday" },
				},
				{
					key: CONFIG_SHOW_WEEKENDS,
					type: "toggle" as const,
					displayName: "Show weekends",
					default: true,
				},
			],
		},
		{
			type: "group" as const,
			displayName: "Cards",
			items: [
				{
					key: CONFIG_SHOW_TIME,
					type: "toggle" as const,
					displayName: "Show time on cards",
					default: true,
				},
			],
		},
	];
}
