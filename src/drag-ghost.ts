// A floating clone of the dragged card that hangs from the cursor and swings
// with horizontal velocity. The native HTML5 drag image is a static snapshot
// the browser owns, so it can't do this — we hide it and render our own.

// Tuning knobs for the pendulum. All feed CSS custom properties, so the visual
// styling itself stays in styles.css.
const POSITION_EASE = 0.5; // how tightly the ghost tracks the cursor (0..1)
const VELOCITY_SMOOTHING = 0.25; // low-pass on the velocity, kills angle jitter
const ANGLE_SPRING = 0.15; // how fast the tilt chases its target (0..1)
const VELOCITY_TO_ANGLE = 0.7; // degrees of tilt per px/frame of horizontal speed
const MAX_ANGLE = 20; // clamp so it never flips over

/** A 1×1 transparent GIF, used to blank out the native drag image. */
const TRANSPARENT_PIXEL = new Image();
TRANSPARENT_PIXEL.src =
	"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export function hideNativeDragImage(dataTransfer: DataTransfer | null): void {
	dataTransfer?.setDragImage(TRANSPARENT_PIXEL, 0, 0);
}

export class DragGhost {
	private el: HTMLElement | null = null;
	private raf = 0;
	/** Where on the card the cursor grabbed it — the anchor and rotation pivot. */
	private grabX = 0;
	private grabY = 0;

	private targetX = 0;
	private targetY = 0;
	private renderX = 0;
	private renderY = 0;
	private prevX = 0;
	private velocity = 0;
	private angle = 0;

	/** Mount on <body> so position:fixed resolves against the viewport; the ghost
	 *  gets its look from the plugin's (unscoped) card CSS plus the copied accent. */
	start(sourceEl: HTMLElement, mountEl: HTMLElement, clientX: number, clientY: number): void {
		this.stop();

		const rect = sourceEl.getBoundingClientRect();
		// The grab point stays under the cursor and the card swings around it.
		this.grabX = clientX - rect.left;
		this.grabY = clientY - rect.top;

		const clone = sourceEl.cloneNode(true) as HTMLElement;
		clone.removeClass("is-dragging");
		clone.addClass("yabacavi-card-ghost");
		clone.style.setProperty("--yabacavi-ghost-width", `${rect.width}px`);
		clone.style.setProperty("--yabacavi-ghost-origin-x", `${this.grabX}px`);
		clone.style.setProperty("--yabacavi-ghost-origin-y", `${this.grabY}px`);

		// Insurance for accent rules scoped deeper than the mount point (e.g. per
		// day cell): copy the colour the source card actually resolved to.
		const computed = activeWindow.getComputedStyle(sourceEl);
		for (const prop of ["--yabacavi-accent-color", "--yabacavi-accent-width"]) {
			const value = computed.getPropertyValue(prop).trim();
			if (value) clone.style.setProperty(prop, value);
		}

		mountEl.appendChild(clone);
		this.el = clone;

		this.targetX = this.renderX = this.prevX = clientX;
		this.targetY = this.renderY = clientY;
		this.velocity = 0;
		this.angle = 0;

		this.tick();
	}

	move(clientX: number, clientY: number): void {
		// The final drag event of a gesture often reports 0,0 — ignore it so the
		// ghost doesn't jump to the corner on release.
		if (clientX === 0 && clientY === 0) return;
		this.targetX = clientX;
		this.targetY = clientY;
	}

	stop(): void {
		if (this.raf) window.cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.el?.remove();
		this.el = null;
	}

	private tick = (): void => {
		if (!this.el) return;

		this.renderX += (this.targetX - this.renderX) * POSITION_EASE;
		this.renderY += (this.targetY - this.renderY) * POSITION_EASE;

		const rawVelocity = this.targetX - this.prevX;
		this.prevX = this.targetX;
		this.velocity += (rawVelocity - this.velocity) * VELOCITY_SMOOTHING;

		// Drag right -> tilt clockwise, like a sign swinging from a rope in your hand.
		const targetAngle = clamp(this.velocity * VELOCITY_TO_ANGLE, -MAX_ANGLE, MAX_ANGLE);
		this.angle += (targetAngle - this.angle) * ANGLE_SPRING;

		// Offset by the grab point so it stays put under the cursor as the card
		// rotates around it (transform-origin matches, set in CSS).
		this.el.style.setProperty("--yabacavi-ghost-x", `${this.renderX - this.grabX}px`);
		this.el.style.setProperty("--yabacavi-ghost-y", `${this.renderY - this.grabY}px`);
		this.el.style.setProperty("--yabacavi-ghost-angle", `${this.angle}deg`);

		this.raf = window.requestAnimationFrame(this.tick);
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
