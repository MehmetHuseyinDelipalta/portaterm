import { bringRow } from "./bringRowView";
import type { BringRow } from "./bringSummaries";

interface GroupOptions {
  rows: readonly BringRow[];
  changedFiles: ReadonlySet<string>;
  addCopy?: HTMLElement;
  addStep?: HTMLElement;
  onStep?: Parameters<typeof bringRow>[2];
}

interface ProvisionGroups {
  elements: HTMLElement[];
  syncSelection(ticked: ReadonlySet<string>): void;
}

function group(title: string, className: string, action?: HTMLElement): { element: HTMLElement; head: HTMLElement } {
  const element = document.createElement("section");
  element.className = `wt-provision-group ${className}`;
  element.setAttribute("aria-label", title);
  const head = document.createElement("div");
  head.className = "wt-provision-heading";
  const label = document.createElement("span");
  label.textContent = title;
  head.appendChild(label);
  if (action) {
    head.appendChild(action);
  }
  element.appendChild(head);
  return { element, head };
}

function disclosure(label: string, id: string, open: boolean): { button: HTMLButtonElement; body: HTMLElement } {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "wt-inline-action";
  button.textContent = label;
  button.setAttribute("aria-controls", id);
  button.setAttribute("aria-expanded", String(open));
  const body = document.createElement("div");
  body.id = id;
  body.hidden = !open;
  button.addEventListener("click", () => {
    body.hidden = !body.hidden;
    button.setAttribute("aria-expanded", String(!body.hidden));
  });
  return { button, body };
}

/** Group existing rows without changing their item identities or selection rules. */
export function createProvisionGroups(options: GroupOptions): ProvisionGroups {
  const { rows } = options;
  const files = rows.filter((row) => row.verb === "Copy" || row.verb === "Link" || row.excluded);
  const setup = rows.filter((row) => row.verb === "Run setup");
  const ports = rows.filter((row) => row.verb === "Allocate port");
  const indexed = new Map(rows.map((row, index) => [row.id, index]));
  const added = new Map(setup.filter((row) => row.added).map((row, index) => [row.id, index]));

  function appendRows(parent: HTMLElement, items: readonly BringRow[]): void {
    let lastKey: string | undefined;
    let source: HTMLElement | undefined;
    for (const row of items) {
      if (row.verb === "Run setup" && row.suggestion !== undefined) {
        parent.appendChild(bringRow(row, indexed.get(row.id) ?? 0, options.onStep, added.get(row.id) ?? 0));
        lastKey = undefined;
        continue;
      }
      const key = `${row.verb}\0${row.source}`;
      if (!source || key !== lastKey) {
        source = document.createElement("div");
        source.className = "wt-bring-source-group";
        const label = document.createElement("div");
        label.className = "wt-bring-source-label";
        label.textContent = `${row.verb === "Run setup" ? "From" : row.verb} · ${row.source}`;
        source.appendChild(label);
        lastKey = key;
        parent.appendChild(source);
      }
      source.appendChild(bringRow(row, indexed.get(row.id) ?? 0, options.onStep, added.get(row.id) ?? 0));
    }
  }

  const review = files.filter(
    (row) =>
      row.suggestion !== undefined ||
      row.contender !== undefined ||
      row.group !== undefined ||
      row.excluded ||
      options.changedFiles.has(row.id),
  );
  const reviewIds = new Set(review.map((row) => row.id));
  const routine = files.filter((row) => !reviewIds.has(row.id) && row.verb !== "Link");
  const links = files.filter((row) => !reviewIds.has(row.id) && row.verb === "Link");
  const allLinks = files.filter((row) => row.verb === "Link");
  const fileGroup = group("Files", "wt-files-group", options.addCopy);
  const fileDisclosure = disclosure(
    review.length ? `Review (${review.length})` : "Edit",
    "wt-files-body",
    review.length > 0,
  );
  fileDisclosure.button.classList.add("wt-files-toggle");
  fileDisclosure.button.hidden = review.length + routine.length === 0;
  fileDisclosure.body.className = "wt-files-body";
  const fileCount = document.createElement("span");
  fileCount.className = "wt-files-count";
  fileGroup.head.insertBefore(fileCount, fileGroup.head.children[1] ?? null);
  fileGroup.head.appendChild(fileDisclosure.button);
  const shared = document.createElement("div");
  shared.className = "wt-files-shared";
  const sharedDisclosure = disclosure("View shared folders", "wt-files-links-body", false);
  sharedDisclosure.button.classList.add("wt-files-links-toggle");
  sharedDisclosure.button.hidden = links.length === 0;
  sharedDisclosure.body.className = "wt-files-links-body";
  sharedDisclosure.body.append(...links.map((row) => bringRow(row, indexed.get(row.id) ?? 0)));
  fileDisclosure.body.append(
    ...(review.length ? review : routine).map((row) => bringRow(row, indexed.get(row.id) ?? 0)),
  );
  const sharedHeading = document.createElement("div");
  sharedHeading.className = "wt-files-shared-heading";
  sharedHeading.append(shared, sharedDisclosure.button);
  sharedHeading.hidden = allLinks.length === 0;
  fileGroup.element.append(sharedHeading, fileDisclosure.body, sharedDisclosure.body);
  if (review.length && routine.length) {
    const extra = disclosure(`Routine files (${routine.length})`, "wt-files-routine-body", false);
    extra.body.className = "wt-files-routine-body";
    extra.body.append(...routine.map((row) => bringRow(row, indexed.get(row.id) ?? 0)));
    fileGroup.element.append(extra.button, extra.body);
  }
  fileGroup.element.hidden = files.length === 0 && !options.addCopy;

  const portGroup = group("Ports", "wt-ports-group");
  appendRows(portGroup.element, ports);
  portGroup.element.hidden = ports.length === 0;

  const setupGroup = group("Setup", "wt-setup-group", options.addStep);
  const setupCount = document.createElement("span");
  setupCount.className = "wt-setup-count";
  setupCount.hidden = setup.length === 1;
  setupGroup.head.insertBefore(setupCount, setupGroup.head.children[1] ?? null);
  const suggestions = setup.filter((row) => row.suggestion !== undefined);
  const configured = setup.filter((row) => row.suggestion === undefined && !row.added);
  const order = document.createElement("div");
  order.className = "wt-setup-order";
  order.textContent = "Selected commands run top to bottom.";
  order.hidden = setup.length < 2;
  setupGroup.element.appendChild(order);
  // Keep contiguous runs rather than collecting by source or suggestion status:
  // execution follows the offer even if a contributor inserts a later command.
  for (let at = 0; at < setup.length; ) {
    const suggested = setup[at]?.suggestion !== undefined;
    const start = at;
    while (at < setup.length && (setup[at]?.suggestion !== undefined) === suggested) {
      at++;
    }
    const items = setup.slice(start, at);
    if (suggested && items.length > 1) {
      const extra = disclosure(
        `Detected commands (${items.length})`,
        `wt-setup-suggestions-${start}`,
        configured.length === 0 || items.some((row) => row.checked),
      );
      extra.button.classList.add("wt-setup-suggestions-toggle");
      extra.body.className = "wt-setup-suggestions";
      appendRows(extra.body, items);
      setupGroup.element.append(extra.button, extra.body);
    } else {
      const direct = document.createElement("div");
      direct.className = suggested ? "wt-setup-suggestions" : "wt-setup-declared";
      appendRows(direct, items);
      setupGroup.element.appendChild(direct);
    }
  }
  setupGroup.element.hidden = setup.length === 0 && !options.addStep;

  return {
    elements: [fileGroup.element, portGroup.element, setupGroup.element],
    syncSelection(ticked) {
      const selected = files.filter((row) => !row.excluded && ticked.has(row.id));
      const linked = selected.filter((row) => row.verb === "Link");
      fileCount.textContent =
        files.length === 0 ? "No extra files" : `${selected.length} selected · ${linked.length} shared`;
      shared.textContent = `${linked.length} shared ${linked.length === 1 ? "folder" : "folders"} — writes to main`;
      shared.hidden = linked.length === 0;
      const selectedSetup = setup.filter((row) => ticked.has(row.id)).length;
      setupCount.textContent =
        setup.length === 0
          ? "No commands"
          : [
              `${configured.length} configured`,
              ...(added.size ? [`${added.size} added`] : []),
              ...(suggestions.length ? [`${suggestions.length} suggested`] : []),
              `${selectedSetup} selected`,
            ].join(" · ");
    },
  };
}
