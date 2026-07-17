import type { DayKey } from "./date-utils";
import { DragGhost, hideNativeDragImage } from "./drag-ghost";

/** Custom type so we only ever react to our own cards, not file-explorer drags. */
const CARD_MIME = "application/x-yabacavi-card";

export interface DragDropCallbacks {
	canDrag: () => boolean;
	onCardDrop: (filePath: string, dayKey: DayKey) => void;
}

/**
 * Listeners live on the grid root rather than on each card, because the view
 * rebuilds every cell on each render — per-card listeners would leak.
 */
export class DragDropManager {
	private rootEl: HTMLElement;
	private doc: Document;
	private callbacks: DragDropCallbacks;
	private draggingEl: HTMLElement | null = null;
	private activeCellEl: HTMLElement | null = null;
	private ghost = new DragGhost();

	constructor(rootEl: HTMLElement, callbacks: DragDropCallbacks) {
		this.rootEl = rootEl;
		this.doc = rootEl.ownerDocument;
		this.callbacks = callbacks;

		// dragstart/drag originate on the source card, so they reach a root listener.
		this.rootEl.addEventListener("dragstart", this.onDragStart);
		this.rootEl.addEventListener("drag", this.onDrag);
		// dragover/drop target whatever is under the cursor — the ghost, usually,
		// which doesn't reliably bubble to rootEl. Listen on the document so they
		// always fire; the MIME check and geometry keep us to our own cards/cells.
		this.doc.addEventListener("dragover", this.onDragOver);
		this.doc.addEventListener("drop", this.onDrop);
		this.doc.addEventListener("dragend", this.onDragEnd);
	}

	destroy(): void {
		this.rootEl.removeEventListener("dragstart", this.onDragStart);
		this.rootEl.removeEventListener("drag", this.onDrag);
		this.doc.removeEventListener("dragover", this.onDragOver);
		this.doc.removeEventListener("drop", this.onDrop);
		this.doc.removeEventListener("dragend", this.onDragEnd);
		this.reset();
	}

	private onDragStart = (evt: DragEvent): void => {
		const cardEl = (evt.target as HTMLElement | null)?.closest<HTMLElement>(".yabacavi-card");
		const filePath = cardEl?.dataset.filePath;
		if (!cardEl || !filePath) return;

		if (!this.callbacks.canDrag()) {
			evt.preventDefault();
			return;
		}

		evt.dataTransfer?.setData(CARD_MIME, filePath);
		if (evt.dataTransfer) evt.dataTransfer.effectAllowed = "move";
		this.draggingEl = cardEl;
		cardEl.addClass("is-dragging");

		// Blank the native snapshot and float our own clone, which can swing.
		hideNativeDragImage(evt.dataTransfer);
		// Mount on <body>, not rootEl: position:fixed must resolve against the
		// viewport, and a transformed ancestor of the view would otherwise offset
		// the ghost downward from the cursor.
		this.ghost.start(cardEl, this.doc.body, evt.clientX, evt.clientY);
	};

	private onDrag = (evt: DragEvent): void => {
		this.ghost.move(evt.clientX, evt.clientY);
	};

	private onDragOver = (evt: DragEvent): void => {
		// Gate on our own drag state, not dataTransfer.types — Electron doesn't
		// reliably expose the custom MIME during dragover, so a types check here
		// silently fails and nothing ever highlights.
		if (!this.draggingEl) return;

		const cellEl = this.cellFromPoint(evt.clientX, evt.clientY);
		if (!cellEl) return;

		evt.preventDefault();
		if (evt.dataTransfer) evt.dataTransfer.dropEffect = "move";
		this.setActiveCell(cellEl);
	};

	private onDrop = (evt: DragEvent): void => {
		// From our own state, not dataTransfer.getData — same Electron caveat.
		const filePath = this.draggingEl?.dataset.filePath;
		const cellEl = this.cellFromPoint(evt.clientX, evt.clientY);
		const dayKey = cellEl?.dataset.dayKey;
		if (!filePath || !dayKey) return;

		evt.preventDefault();
		this.reset();
		this.callbacks.onCardDrop(filePath, dayKey);
	};

	/**
	 * The day cell under the cursor, found by testing the cursor against each
	 * cell's rectangle. Pure geometry — it ignores the ghost sitting over the
	 * cursor entirely, which DOM hit-testing (evt.target / elementsFromPoint)
	 * couldn't get past during a native drag.
	 */
	private cellFromPoint(clientX: number, clientY: number): HTMLElement | null {
		const cells = this.rootEl.querySelectorAll<HTMLElement>("[data-day-key]");
		for (const cell of Array.from(cells)) {
			const r = cell.getBoundingClientRect();
			if (clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom) {
				return cell;
			}
		}
		return null;
	}

	private onDragEnd = (): void => {
		this.reset();
	};

	private setActiveCell(cellEl: HTMLElement): void {
		if (this.activeCellEl === cellEl) return;
		this.activeCellEl?.removeClass("is-drop-target");
		cellEl.addClass("is-drop-target");
		this.activeCellEl = cellEl;
	}

	private reset(): void {
		this.ghost.stop();
		this.draggingEl?.removeClass("is-dragging");
		this.activeCellEl?.removeClass("is-drop-target");
		this.draggingEl = null;
		this.activeCellEl = null;
	}
}
