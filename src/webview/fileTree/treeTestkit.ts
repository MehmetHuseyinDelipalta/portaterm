/** Yield to the microtask queue so resolved promises and row rebuilds run. */
export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

export function makeHost(): HTMLElement {
  const host = document.createElement("div");
  host.style.width = "300px";
  host.style.height = "400px";
  document.body.appendChild(host);
  return host;
}

export function readRowLabels(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll<HTMLSpanElement>(".test-row"))
    .map((element) => element.textContent ?? "")
    .filter((label) => label.length > 0);
}
