const toggle = document.getElementById("menu-toggle"),
  navigation = document.getElementById("site-nav");
function closeMenu() {
  toggle?.setAttribute("aria-expanded", "false");
  navigation?.classList.remove("open");
}
toggle?.addEventListener("click", () => {
  const expanded = toggle.getAttribute("aria-expanded") === "true";
  toggle.setAttribute("aria-expanded", String(!expanded));
  navigation?.classList.toggle("open", !expanded);
});
const dialog = document.getElementById("delete-dialog"),
  cancel = document.getElementById("delete-cancel"),
  confirm = document.getElementById("delete-confirm");
let pending: HTMLFormElement | undefined,
  approved = false;
if (dialog instanceof HTMLDialogElement) {
  for (const form of document.querySelectorAll<HTMLFormElement>(
    "[data-confirm-delete]",
  ))
    form.addEventListener("submit", (event) => {
      if (approved && pending === form) return;
      approved = false;
      event.preventDefault();
      pending = form;
      dialog.showModal();
      cancel?.focus();
    });
  cancel?.addEventListener("click", () => dialog.close());
  confirm?.addEventListener("click", () => {
    if (!pending) return;
    approved = true;
    dialog.close();
    pending.requestSubmit();
  });
  dialog.addEventListener("close", () => {
    if (!approved) pending?.querySelector("button")?.focus();
  });
}
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Tab" &&
    toggle?.getAttribute("aria-expanded") === "true" &&
    window.matchMedia("(max-width:850px)").matches
  ) {
    const items = [
      toggle,
      ...(navigation?.querySelectorAll<HTMLElement>("a[href],button") ?? []),
    ];
    const first = items[0],
      last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  if (event.key === "Escape") {
    closeMenu();
    if (!(dialog instanceof HTMLDialogElement) || !dialog.open) toggle?.focus();
  }
});

for (const form of document.querySelectorAll<HTMLFormElement>(
  "form[method='post']",
)) {
  let submitted = false;
  form.addEventListener("submit", (event) => {
    if (event.defaultPrevented) return;
    if (submitted) {
      event.preventDefault();
      return;
    }
    submitted = true;
    for (const button of form.querySelectorAll<HTMLButtonElement>(
      "button[type='submit']",
    )) {
      button.dataset.readyLabel = button.textContent ?? "";
      button.textContent = "En cours…";
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    }
  });
  window.addEventListener("pageshow", () => {
    submitted = false;
    for (const button of form.querySelectorAll<HTMLButtonElement>(
      "button[type='submit']",
    )) {
      button.disabled = false;
      if (button.dataset.readyLabel !== undefined)
        button.textContent = button.dataset.readyLabel;
      button.removeAttribute("aria-busy");
    }
  });
}

window.addEventListener("pageshow", () => {
  approved = false;
  pending = undefined;
});

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-password-toggle]",
)) {
  const field = document.getElementById(button.dataset.passwordToggle || "");
  if (!(field instanceof HTMLInputElement)) continue;
  button.addEventListener("click", () => {
    const visible = field.type === "password";
    field.type = visible ? "text" : "password";
    button.setAttribute("aria-pressed", String(visible));
    button.textContent = visible
      ? "Masquer le mot de passe"
      : "Afficher le mot de passe";
  });
}
document.querySelector<HTMLElement>("[role='alert']")?.focus();

const ENTRY_PATH = "/login",
  HOME_PATH = "/businessCard";
// La session du serveur reste la référence, y compris entre onglets.
const sessionMeta = document.querySelector<HTMLMetaElement>(
  'meta[name="session-key"]',
);
const identityMeta = document.querySelector<HTMLMetaElement>(
  'meta[name="identity-key"]',
);
const expectedSession = sessionMeta?.content ?? "visitor";
const expectedIdentity = identityMeta?.content ?? "visitor";
let checking = false,
  navigating = false,
  recheckPending = false,
  dirty = false;
document.addEventListener("input", () => {
  dirty = true;
});
const channel =
  typeof BroadcastChannel === "function"
    ? new BroadcastChannel("session-state")
    : undefined;
function networkNotice(message?: string) {
  const banner = document.getElementById("network-status");
  const text = document.getElementById("network-message");
  if (banner) banner.hidden = !message;
  if (text) text.textContent = message ?? "";
}
document.getElementById("session-retry")?.addEventListener("click", () => {
  void checkSession();
});
async function checkSession() {
  if (navigating) return;
  if (checking) {
    recheckPending = true;
    return;
  }
  checking = true;
  try {
    const response = await fetch("/session", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      networkNotice(
        "Le service est momentanément indisponible. Vos données saisies restent dans cet onglet.",
      );
      return;
    }
    const value: unknown = await response.json();
    if (
      !value ||
      typeof value !== "object" ||
      !("key" in value) ||
      typeof value.key !== "string" ||
      !("identity" in value) ||
      typeof value.identity !== "string"
    )
      return;
    if (value.key === expectedSession) {
      networkNotice();
      return;
    }
    navigating = true;
    if (dirty && expectedIdentity !== "visitor") {
      const fields: Record<string, { value: string; checked?: boolean }> = {};
      for (const field of document.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >("main input, main textarea, main select")) {
        if (
          !field.name ||
          field.name === "_csrf" ||
          (field instanceof HTMLInputElement &&
            ["password", "hidden", "file"].includes(field.type))
        )
          continue;
        fields[field.name] = {
          value: field.value,
          ...(field instanceof HTMLInputElement &&
          ["checkbox", "radio"].includes(field.type)
            ? { checked: field.checked }
            : {}),
        };
      }
      sessionStorage.setItem(
        `draft:${expectedIdentity}:${location.pathname}`,
        JSON.stringify(fields),
      );
    }
    // Ne pas laisser des données du compte précédent affichées pendant le changement.
    document.querySelector("main")?.replaceChildren();
    sessionStorage.setItem(
      "session-refresh",
      dirty
        ? "La session a changé. Votre brouillon est conservé dans cet onglet pour votre compte."
        : value.identity === "visitor"
          ? "Votre session est terminée. Vous pouvez vous reconnecter quand vous voulez."
          : "Votre accès a été mis à jour.",
    );
    channel?.postMessage("changed");
    location.replace(value.identity === "visitor" ? ENTRY_PATH : HOME_PATH);
  } catch {
    networkNotice(
      "La connexion est interrompue. Votre page et vos données saisies sont conservées.",
    );
  } finally {
    checking = false;
    if (recheckPending && !navigating) {
      recheckPending = false;
      void checkSession();
    }
  }
}
channel?.addEventListener("message", () => {
  void checkSession();
});
window.addEventListener("focus", () => {
  void checkSession();
});
window.addEventListener("pageshow", () => {
  void checkSession();
  channel?.postMessage("changed");
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void checkSession();
});
window.addEventListener("session-ended", () => {
  void checkSession();
});
let interval: number | undefined;
function startPolling() {
  if (interval !== undefined) return;
  interval = window.setInterval(() => {
    if (!document.hidden) void checkSession();
  }, 5000);
}
startPolling();
window.addEventListener("pageshow", startPolling);
window.addEventListener("pagehide", () => {
  clearInterval(interval);
  interval = undefined;
});
const deadline = Number(
  document.querySelector<HTMLMetaElement>('meta[name="session-expires"]')
    ?.content,
);
if (deadline > Date.now())
  window.setTimeout(
    () => {
      void checkSession();
    },
    Math.min(deadline - Date.now() + 30, 2147483647),
  );
const notice = sessionStorage.getItem("session-refresh");
if (notice) {
  sessionStorage.removeItem("session-refresh");
  const alert = document.createElement("p");
  alert.className = "session-notice";
  alert.setAttribute("role", "status");
  alert.tabIndex = -1;
  alert.textContent = notice;
  document.querySelector("main")?.prepend(alert);
  alert.focus();
}
const draftKey = `draft:${expectedIdentity}:${location.pathname}`;
const draft = sessionStorage.getItem(draftKey);
if (draft && expectedIdentity !== "visitor") {
  try {
    const fields: unknown = JSON.parse(draft);
    if (fields && typeof fields === "object")
      for (const field of document.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >("main input, main textarea, main select")) {
        if (field.name in fields) {
          const value: unknown = Reflect.get(fields, field.name);
          if (
            value &&
            typeof value === "object" &&
            "value" in value &&
            typeof value.value === "string"
          ) {
            field.value = value.value;
            if (
              field instanceof HTMLInputElement &&
              "checked" in value &&
              typeof value.checked === "boolean"
            )
              field.checked = value.checked;
            const details = field.closest("details");
            if (details && field.value) details.open = true;
          }
        }
      }
    sessionStorage.removeItem(draftKey);
  } catch {
    sessionStorage.removeItem(draftKey);
  }
}

const backupFile = document.getElementById("backup-file");
if (backupFile instanceof HTMLInputElement)
  backupFile.addEventListener("change", async () => {
    const file = backupFile.files?.[0];
    const field = document.getElementById("backup");
    const status = document.getElementById("backup-file-status");
    if (!file || !(field instanceof HTMLTextAreaElement) || !status) return;
    if (file.size > 512 * 1024) {
      status.textContent = "Le fichier dépasse 512 Ko.";
      field.value = "";
      return;
    }
    try {
      field.value = await file.text();
      status.textContent = `${file.name} est prêt à être vérifié.`;
      dirty = true;
    } catch {
      status.textContent =
        "Impossible de lire le fichier. Vous pouvez coller son contenu.";
    }
  });

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-copy-contact]",
))
  button.addEventListener("click", async () => {
    const feedback = button
      .closest("article")
      ?.querySelector<HTMLElement>(".copy-feedback");
    if (!feedback) return;
    feedback.hidden = false;
    try {
      await navigator.clipboard.writeText(button.dataset.copyContact ?? "");
      feedback.textContent = "Coordonnées copiées.";
    } catch {
      feedback.textContent =
        "La copie est indisponible. Sélectionnez les coordonnées dans la carte.";
    }
  });
