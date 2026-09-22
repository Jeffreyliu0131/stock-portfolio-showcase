const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true",
  );
}

export function trapModalTabKey(
  event: KeyboardEvent,
  container: HTMLElement,
): void {
  if (event.key !== "Tab") {
    return;
  }
  const focusable = focusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Keeps keyboard focus inside a mounted modal while reusing the same
 * background isolation contract across every bottom sheet.
 */
export function containModalFocus(dialog: HTMLElement): () => void {
  const releaseIsolation = isolateModalSiblings(dialog);
  const focusable = focusableElements(dialog);
  const requestedInitialFocus = dialog.querySelector<HTMLElement>(
    "[data-autofocus]",
  );
  const initialFocus =
    requestedInitialFocus !== null && focusable.includes(requestedInitialFocus)
      ? requestedInitialFocus
      : (focusable[0] ?? dialog);
  initialFocus.focus();
  const trapTabKey = (event: KeyboardEvent) => {
    trapModalTabKey(event, dialog);
  };
  document.addEventListener("keydown", trapTabKey);

  return () => {
    document.removeEventListener("keydown", trapTabKey);
    releaseIsolation();
  };
}

/**
 * Keeps background content out of keyboard and accessibility navigation while
 * a non-portal modal is open, then restores every prior attribute exactly.
 */
export function isolateModalSiblings(dialog: HTMLElement): () => void {
  const elements = new Set<HTMLElement>();
  let current: HTMLElement | null = dialog.parentElement ?? dialog;

  // Walk all the way to <body>, isolating only siblings at each level. This
  // keeps every ancestor that contains the dialog interactive, including the
  // wrapper inserted by test renderers or application layouts.
  while (current !== document.body) {
    const parent: HTMLElement | null = current.parentElement;
    if (parent === null) {
      break;
    }
    for (const sibling of Array.from(parent.children)) {
      if (sibling !== current && sibling instanceof HTMLElement) {
        elements.add(sibling);
      }
    }
    current = parent;
  }

  const previous = Array.from(elements, (element) => ({
    element,
    inert: element.hasAttribute("inert"),
    ariaHidden: element.getAttribute("aria-hidden"),
  }));
  for (const { element } of previous) {
    element.setAttribute("inert", "");
    element.setAttribute("aria-hidden", "true");
  }
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  return () => {
    for (const { element, inert, ariaHidden } of previous) {
      if (!inert) {
        element.removeAttribute("inert");
      }
      if (ariaHidden === null) {
        element.removeAttribute("aria-hidden");
      } else {
        element.setAttribute("aria-hidden", ariaHidden);
      }
    }
    document.body.style.overflow = previousOverflow;
  };
}
