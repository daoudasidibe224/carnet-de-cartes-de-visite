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
