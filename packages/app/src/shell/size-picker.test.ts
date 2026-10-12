// @vitest-environment jsdom

/**
 * @file size-picker.test.ts
 * @purpose Vitest test suite for K-Doc's table size picker overlay (packages/app/src/shell/size-picker.ts, FR-8.18).
 *   Verifies matrix DOM construction, hover state tracking, keyboard navigation, click confirmation, dismissal, and teardown.
 * @inputs SizePickerOptions containing Document, Window, and onPick callback spy.
 * @outputs Vitest assertions verifying cell activation counts, caption text updates, coordinates clamping, and event prevention.
 * @functions
 *   - createTestPicker: Helper constructing a SizePicker instance attached to global document and window contexts.
 *   - getPickerContainer: Helper retrieving the active .kdoc-size-picker DOM container from document.body.
 * @dataflow Synthetic mouse and keyboard events -> SizePicker event listeners -> DOM attribute updates & onPick invocations -> Vitest expect assertions.
 * @controlflow Mount SizePicker -> test initial grid construction and openAt cell count stability -> test hover activation -> test click selection -> test arrow key navigation -> test escape dismissal -> test mousedown preventDefault -> test destroy lifecycle.
 * @version 1
 * @date 2026-09-06
 */

import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  installSizePicker,
  MAX_PICKER_ROWS,
  MAX_PICKER_COLUMNS,
  type SizePicker,
  type SizePickerOptions,
} from './size-picker.js';

let activePickers: SizePicker[] = [];

afterEach((): void => {
  for (let i = 0; i < activePickers.length; i++) {
    const picker = activePickers[i];
    // Check if picker controller is defined under strict indexing.
    if (picker !== undefined) {
      // Destroy active picker to clean up mounted DOM elements and listeners.
      picker.destroy();
    } else {
      // No picker controller at index.
    }
  }
  activePickers = [];
});

/**
 * Helper factory constructing and tracking a SizePicker instance for testing.
 *
 * @purpose Creates a SizePicker instance bound to document and window, tracked in activePickers for automated afterEach cleanup.
 * @inputs onPick - Optional callback function triggered when dimensions are picked.
 * @outputs SizePicker - The instantiated SizePicker controller.
 * @dataflow options -> installSizePicker -> record in activePickers -> return controller.
 * @controlflow Build options with doc, win, and callback -> call installSizePicker -> push to activePickers -> return instance.
 */
function createTestPicker(
  onPick?: (rows: number, columns: number) => void,
): SizePicker {
  const options: SizePickerOptions = {
    doc: document,
    win: window,
    onPick: onPick !== undefined ? onPick : (): void => {},
  };
  const picker = installSizePicker(options);
  activePickers.push(picker);
  return picker;
}

/**
 * Retrieves the mounted size picker container element from document.body.
 *
 * @purpose Finds the .kdoc-size-picker div in document.body or fails the test if missing.
 * @inputs void.
 * @outputs HTMLDivElement - The mounted picker container element.
 * @dataflow document.body.querySelector -> HTMLDivElement.
 * @controlflow Query .kdoc-size-picker selector -> verify existence as HTMLDivElement -> return or fail test.
 */
function getPickerContainer(): HTMLDivElement {
  const container = document.body.querySelector('.kdoc-size-picker');
  // Check if container element exists in DOM and is an HTMLDivElement.
  if (container instanceof HTMLDivElement) {
    return container;
  } else {
    expect.fail('Expected .kdoc-size-picker element to be mounted in document.body');
  }
}

describe('size-picker', () => {
  it('creates a hidden container with MAX_PICKER_ROWS * MAX_PICKER_COLUMNS cells built once across openAt calls', () => {
    // Pins that installSizePicker builds 80 cells once at construction and does not rebuild them on openAt calls.
    const picker = createTestPicker();
    const container = getPickerContainer();

    expect(container.hidden).toBe(true);
    const cellsInitial = container.querySelectorAll('.kdoc-size-picker-cell');
    expect(cellsInitial.length).toBe(MAX_PICKER_ROWS * MAX_PICKER_COLUMNS);

    // Call openAt twice to pin that the grid elements are not rebuilt per open.
    picker.openAt(100, 100);
    const cellsFirstOpen = container.querySelectorAll('.kdoc-size-picker-cell');
    expect(cellsFirstOpen.length).toBe(MAX_PICKER_ROWS * MAX_PICKER_COLUMNS);

    picker.openAt(120, 140);
    const cellsSecondOpen = container.querySelectorAll('.kdoc-size-picker-cell');
    expect(cellsSecondOpen.length).toBe(MAX_PICKER_ROWS * MAX_PICKER_COLUMNS);
  });

  it('unhides the container and highlights 1x1 on openAt so the keyboard has a starting point', () => {
    // Pins that openAt unhides the container and activates the 1x1 cell as an initial keyboard starting point.
    const picker = createTestPicker();
    const container = getPickerContainer();

    picker.openAt(50, 50);
    expect(container.hidden).toBe(false);
    expect(picker.isOpen).toBe(true);

    const activeCells = container.querySelectorAll('.kdoc-size-picker-cell-active');
    expect(activeCells.length).toBe(1);

    const label = container.querySelector('.kdoc-size-picker-label');
    expect(label?.textContent).toBe('1 × 1 table');
  });

  it('clamps coordinates to stay on screen when opened with negative or boundary coordinates', () => {
    // Pins that openAt clamps coordinates to keep the picker reachable on screen.
    // jsdom does not implement layout, so offsetWidth/offsetHeight are 0 — clamping is asserted where meaningful.
    const picker = createTestPicker();
    const container = getPickerContainer();

    // Negative coordinates must clamp to 0.
    picker.openAt(-50, -80);
    expect(container.style.left).toBe('0px');
    expect(container.style.top).toBe('0px');

    // Positive coordinates within viewport stay as specified (since offset dimensions are 0 in jsdom).
    picker.openAt(150, 200);
    expect(container.style.left).toBe('150px');
    expect(container.style.top).toBe('200px');
  });

  it('activates exactly 12 cells and updates caption on mouseenter of 3 rows by 4 columns cell', () => {
    // Pins that mouseenter on a cell activates all cells in the rectangle and updates the caption label.
    const picker = createTestPicker();
    const container = getPickerContainer();
    picker.openAt(50, 50);

    const targetCell = container.querySelector(
      '.kdoc-size-picker-cell[aria-label="3 rows by 4 columns"]',
    );
    // Check if target cell element exists.
    if (targetCell instanceof HTMLElement) {
      targetCell.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    } else {
      expect.fail('Expected cell with aria-label "3 rows by 4 columns" to exist');
    }

    const activeCells = container.querySelectorAll('.kdoc-size-picker-cell-active');
    expect(activeCells.length).toBe(12);

    const label = container.querySelector('.kdoc-size-picker-label');
    expect(label?.textContent).toBe('3 × 4 table');
  });

  it('calls onPick(3, 4) once and closes when clicking the 3 rows by 4 columns cell', () => {
    // Pins that clicking a cell invokes onPick once with 1-based dimensions and closes the picker.
    const onPickSpy = vi.fn();
    const picker = createTestPicker(onPickSpy);
    const container = getPickerContainer();
    picker.openAt(50, 50);

    const targetCell = container.querySelector(
      '.kdoc-size-picker-cell[aria-label="3 rows by 4 columns"]',
    );
    // Check if target cell element exists.
    if (targetCell instanceof HTMLElement) {
      targetCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } else {
      expect.fail('Expected cell with aria-label "3 rows by 4 columns" to exist');
    }

    expect(onPickSpy).toHaveBeenCalledTimes(1);
    expect(onPickSpy).toHaveBeenCalledWith(3, 4);
    expect(picker.isOpen).toBe(false);
    expect(container.hidden).toBe(true);
  });

  it('navigates with ArrowRight then ArrowDown to 2x2 and picks (2, 2) on Enter', () => {
    // Pins that ArrowRight and ArrowDown keyboard navigation shifts highlight to 2x2 and Enter picks it.
    const onPickSpy = vi.fn();
    const picker = createTestPicker(onPickSpy);
    const container = getPickerContainer();
    picker.openAt(50, 50);

    // Initial state is 1x1. ArrowRight moves to 1x2.
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true, bubbles: true }),
    );

    // ArrowDown moves to 2x2.
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, bubbles: true }),
    );

    const activeCells = container.querySelectorAll('.kdoc-size-picker-cell-active');
    expect(activeCells.length).toBe(4);

    const label = container.querySelector('.kdoc-size-picker-label');
    expect(label?.textContent).toBe('2 × 2 table');

    // Enter confirms pick.
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true }),
    );

    expect(onPickSpy).toHaveBeenCalledTimes(1);
    expect(onPickSpy).toHaveBeenCalledWith(2, 2);
    expect(picker.isOpen).toBe(false);
    expect(container.hidden).toBe(true);
  });

  it('closes without calling onPick when Escape is pressed', () => {
    // Pins that Escape closes the open picker without invoking onPick.
    const onPickSpy = vi.fn();
    const picker = createTestPicker(onPickSpy);
    const container = getPickerContainer();
    picker.openAt(50, 50);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true }),
    );

    expect(onPickSpy).not.toHaveBeenCalled();
    expect(picker.isOpen).toBe(false);
    expect(container.hidden).toBe(true);
  });

  it('calls preventDefault on container mousedown to protect editor selection and focus', () => {
    // Pins that mousedown on the picker container calls preventDefault to avoid blurring the editor.
    // Without it, clicking the picker moves focus out of the editor pane and collapses the selection,
    // so the table would land in the wrong place — the same defect the format toolbar had.
    createTestPicker();
    const container = getPickerContainer();

    const mousedownEvent = new MouseEvent('mousedown', {
      cancelable: true,
      bubbles: true,
    });
    container.dispatchEvent(mousedownEvent);

    expect(mousedownEvent.defaultPrevented).toBe(true);
  });

  it('removes the element from the document and is idempotent on destroy', () => {
    // Pins that destroy removes the container from document.body and can be called repeatedly without error.
    const picker = createTestPicker();
    const container = getPickerContainer();
    expect(document.body.contains(container)).toBe(true);

    picker.destroy();
    expect(document.body.contains(container)).toBe(false);
    expect(picker.isOpen).toBe(false);

    // Call destroy a second time to verify idempotence.
    expect((): void => {
      picker.destroy();
    }).not.toThrow();
    expect(document.body.contains(container)).toBe(false);
  });
});
