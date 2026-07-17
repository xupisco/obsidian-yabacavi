import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";
import globals from "globals";

export default defineConfig([
	{
		ignores: ["main.js"],
	},
	{
		linterOptions: {
			reportUnusedDisableDirectives: "error",
		},
	},

	...tseslint.configs.recommendedTypeChecked,
	...(obsidianmd.configs?.recommendedWithLocalesEn || []),
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parser: tsparser,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-deprecated": "error",
			// The recommended preset ships this off, but Obsidian's own release
			// scanner flags it — popout windows have their own document.
			"obsidianmd/prefer-active-doc": "error",
		},
	},
	{
		// PluginSettingTab.display() is soft-deprecated in 1.13 for the declarative
		// settings API, which doesn't cleanly model the dynamic add/remove colour
		// list. display() is still fully functional; keep no-deprecated on elsewhere.
		files: ["src/settings.ts"],
		rules: {
			"@typescript-eslint/no-deprecated": "off",
		},
	},
]);
