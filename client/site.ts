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
      if (approved) return;
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
