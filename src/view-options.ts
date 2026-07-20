import type { BasesAllOptions } from "obsidian";

export const CONFIG_DATE_PROPERTY = "dateProperty";
export const CONFIG_RANGE = "range";
export const CONFIG_WEEK_START = "weekStart";
export const CONFIG_SHOW_WEEKENDS = "showWeekends";
export const CONFIG_SHOW_TIME = "showTime";
export const CONFIG_SHOW_CREATED = "showCreated";
export const CONFIG_CARD_WIDTH = "cardWidth";
export const CONFIG_DAY_COUNT = "dayCount";

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
					key: CONFIG_DAY_COUNT,
					type: "slider" as const,
					displayName: "Days shown (Day range)",
					default: 1,
					min: 1,
					max: 7,
					step: 1,
					instant: true,
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
				{
					key: CONFIG_SHOW_CREATED,
					type: "toggle" as const,
					displayName: "Also show notes by creation date",
					default: false,
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
				{
					key: CONFIG_CARD_WIDTH,
					type: "slider" as const,
					displayName: "Day view card width",
					default: 260,
					min: 160,
					max: 480,
					step: 20,
					instant: true,
				},
			],
		},
	];
}
