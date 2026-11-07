import { describe, expect, it } from 'vitest';

async function loadDragOrder() {
  const moduleUrl = new URL('../src/ui/public/drag-order.js', import.meta.url);
  return import(/* @vite-ignore */ moduleUrl.href);
}

// Three 40px rows with an 8px gap: [0,40] [48,88] [96,136].
const rows = [{ top: 0, bottom: 40 }, { top: 48, bottom: 88 }, { top: 96, bottom: 136 }];

describe('drag-order helpers', () => {
  it('dropSlot picks the gap before the first row whose middle is below the pointer', async () => {
    const { dropSlot } = await loadDragOrder();
    const mids = [20, 68, 116];
    expect(dropSlot(mids, 5)).toBe(0);
    expect(dropSlot(mids, 44)).toBe(1);
    expect(dropSlot(mids, 130)).toBe(3);
  });

  it('slotToIndex accounts for the dragged item leaving its place and ignores no-op gaps', async () => {
    const { slotToIndex } = await loadDragOrder();
    expect(slotToIndex(0, 0)).toBeNull();
    expect(slotToIndex(0, 1)).toBeNull();
    expect(slotToIndex(0, 2)).toBe(1);
    expect(slotToIndex(0, 3)).toBe(2);
    expect(slotToIndex(2, 0)).toBe(0);
    expect(slotToIndex(2, 2)).toBeNull();
  });

  it('dropTarget: the middle of another row takes its position', async () => {
    const { dropTarget } = await loadDragOrder();
    expect(dropTarget(rows, 68, 0)).toEqual({ kind: 'onto', index: 1, to: 1 });
    expect(dropTarget(rows, 116, 0)).toEqual({ kind: 'onto', index: 2, to: 2 });
    expect(dropTarget(rows, 20, 2)).toEqual({ kind: 'onto', index: 0, to: 0 });
  });

  it('dropTarget: row edges and gaps insert between rows', async () => {
    const { dropTarget } = await loadDragOrder();
    // Gap between rows 1 and 2, dragging row 0: lands at index 1 (after row 1).
    expect(dropTarget(rows, 92, 0)).toEqual({ kind: 'between', slot: 2, to: 1 });
    // Top edge of row 1 while dragging row 2: insert before row 1.
    expect(dropTarget(rows, 50, 2)).toEqual({ kind: 'between', slot: 1, to: 1 });
    // Bottom edge of the last row: move to the end.
    expect(dropTarget(rows, 134, 0)).toEqual({ kind: 'between', slot: 3, to: 2 });
    // Above the first row while dragging the last: move to the top.
    expect(dropTarget(rows, -4, 2)).toEqual({ kind: 'between', slot: 0, to: 0 });
  });

  it('dropTarget returns null when the drop would not change the order', async () => {
    const { dropTarget } = await loadDragOrder();
    expect(dropTarget(rows, 20, 0)).toBeNull();
    expect(dropTarget(rows, 44, 0)).toBeNull();
    expect(dropTarget(rows, 92, 2)).toBeNull();
  });

  it('moveItem returns a reordered copy', async () => {
    const { moveItem } = await loadDragOrder();
    const items = ['a', 'b', 'c', 'd'];
    expect(moveItem(items, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(items, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(items).toEqual(['a', 'b', 'c', 'd']);
  });
});
