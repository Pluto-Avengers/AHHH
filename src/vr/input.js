/** Mouse drags in the laptop preview shouldn't count as clicks (hand pinches have no drag distance). */
export const isDrag = (e) => e.delta > 6

/** The laptop preview's look-around control (set by PlayerRig); paused while a window is dragged. */
export const desktopLook = { current: null }
