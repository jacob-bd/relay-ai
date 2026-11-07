// Pure helpers for drag-to-reorder lists (insertion position and the resulting order).

/**
 * The gap the pointer is over, 0..rows: before the first row whose vertical midpoint is below it.
 * Works in the gaps between rows too, not only while hovering a row.
 */
export function dropSlot(rowMidpoints, pointerY) {
  let slot = 0;
  while (slot < rowMidpoints.length && pointerY > rowMidpoints[slot]) slot += 1;
  return slot;
}

/** Final index for an item dragged from `from` into gap `slot`, or null when the order would not change. */
export function slotToIndex(from, slot) {
  const to = slot > from ? slot - 1 : slot;
  return to === from ? null : to;
}

/**
 * Where a drag lands given each row's `{ top, bottom }`: the middle half of another row is "onto"
 * (the item takes that row's index); row edges and the gaps between rows are "between" (insert at a gap).
 * Returns null when the drop would not change the order.
 */
export function dropTarget(rowBoxes, pointerY, from) {
  const index = rowBoxes.findIndex(box => pointerY >= box.top && pointerY <= box.bottom);
  if (index >= 0 && index !== from) {
    const box = rowBoxes[index];
    const edge = (box.bottom - box.top) / 4;
    if (pointerY > box.top + edge && pointerY < box.bottom - edge) return { kind: 'onto', index, to: index };
  }
  const slot = dropSlot(rowBoxes.map(box => (box.top + box.bottom) / 2), pointerY);
  const to = slotToIndex(from, slot);
  return to === null ? null : { kind: 'between', slot, to };
}

/** A copy of `items` with the item at `from` moved to `to`. */
export function moveItem(items, from, to) {
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
