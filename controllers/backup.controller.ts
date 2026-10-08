import { z } from "zod";
import { authenticatedUser, type Controller } from "../types";
import { applyBackup, previewBackup } from "../services/backup.service";
import { CardConflict } from "../services/cards.service";
export const importForm: Controller = (_req, res) =>
  res.render("importBackup", { raw: "", plan: null });
export const preview: Controller = async (req, res) => {
  const input = z.object({ backup: z.string() }).safeParse(req.body);
  if (!input.success)
    return res
      .status(422)
      .render("importBackup", {
        raw: "",
        plan: null,
        errors: {
          form: "Choisissez une sauvegarde JSON ou collez son contenu.",
        },
      });
  try {
    const plan = await previewBackup(
      authenticatedUser(req).id,
      input.data.backup,
    );
    req.session.backupPlan = plan;
    res.render("importBackup", { raw: input.data.backup, plan });
  } catch (error) {
    if (!(error instanceof CardConflict)) throw error;
    res
      .status(422)
      .render("importBackup", {
        raw: input.data.backup,
        plan: null,
        errors: { form: error.message },
      });
  }
};
export const apply: Controller = async (req, res) => {
  const key = z.object({ key: z.uuid() }).safeParse(req.body);
  const plan = req.session.backupPlan;
  if (!key.success || !plan || key.data.key !== plan.key)
    return res
      .status(409)
      .render("importBackup", {
        raw: "",
        plan: null,
        errors: {
          form: "Cet aperçu n’est plus disponible. Vérifiez à nouveau la sauvegarde.",
        },
      });
  try {
    const count = await applyBackup(authenticatedUser(req).id, plan);
    delete req.session.backupPlan;
    req.session.notice = `${count} ${count > 1 ? "contacts restaurés" : "contact restauré"} dans votre carnet, avec vos notes privées.`;
    res.redirect("/businessCard/savedBusinessCard");
  } catch (error) {
    if (!(error instanceof CardConflict)) throw error;
    delete req.session.backupPlan;
    res
      .status(409)
      .render("importBackup", {
        raw: JSON.stringify({
          version: 1,
          contacts: plan.contacts.map((item) => item.values),
        }),
        plan: null,
        errors: { form: error.message },
      });
  }
};
