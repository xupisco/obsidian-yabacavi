import { Modal, TFile, WorkspaceLeaf, type App } from "obsidian";

/**
 * Shows a note's real editor inside a modal.
 *
 * Obsidian has no public API for embedding an editable note outside the
 * workspace, so this builds a WorkspaceLeaf that the workspace never learns
 * about and re-parents its container into the modal. `WorkspaceLeaf`'s
 * constructor isn't public — hence the cast — but an orphaned leaf is the only
 * way to get a fully working editor here, and it's what other Bases views do.
 */
export class NoteModal extends Modal {
	private file: TFile;
	private leaf: WorkspaceLeaf | null = null;

	constructor(app: App, file: TFile) {
		super(app);
		this.file = file;
	}

	async onOpen(): Promise<void> {
		this.modalEl.addClass("yabacavi-note-modal");
		this.titleEl.setText(this.file.basename);
		this.contentEl.empty();

		const LeafCtor = WorkspaceLeaf as unknown as new (app: App) => WorkspaceLeaf;
		this.leaf = new LeafCtor(this.app);
		await this.leaf.openFile(this.file, { active: false });

		this.contentEl.appendChild(this.leaf.view.containerEl);
		this.leaf.view.containerEl.addClass("yabacavi-modal-leaf");
	}

	onClose(): void {
		this.leaf?.detach();
		this.leaf = null;
		this.contentEl.empty();
	}
}
