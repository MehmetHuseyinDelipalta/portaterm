const FOCUSABLE_SELECTOR = 'textarea:not([readonly]), input, select, button, [tabindex]:not([tabindex="-1"])';

export interface FocusTrap {
  /** Re-read which controls are focusable after the dialog changes. */
  refresh: () => void;
  /** Handle Tab/Shift+Tab wrapping for the dialog. */
  handleKeyDown: (event: KeyboardEvent) => void;
  /** Land focus on a preferred control or the first focusable control. */
  focusInitial: (preferred?: HTMLElement) => void;
}

/**
 * Trap Tab focus using controls found under `queryRoot` while deciding whether
 * focus is outside the modal with `containmentRoot`.
 */
export function createFocusTrap(queryRoot: ParentNode, containmentRoot: Node): FocusTrap {
  const focusable = (): HTMLElement[] =>
    Array.from(queryRoot.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (element) => !element.closest("[hidden]") && !(element instanceof HTMLButtonElement && element.disabled),
    );

  let controls = focusable();

  const refresh = (): void => {
    controls = focusable();
  };

  return {
    refresh,
    handleKeyDown: (event) => {
      if (event.key !== "Tab") {
        return;
      }
      refresh();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (
        event.shiftKey
          ? active === first || !containmentRoot.contains(active)
          : active === last || !containmentRoot.contains(active)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    },
    focusInitial: (preferred) => {
      refresh();
      (preferred ?? controls[0])?.focus();
    },
  };
}
