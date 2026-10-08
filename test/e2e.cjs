const path = require("node:path"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
const { MongoMemoryReplSet } = require("mongodb-memory-server"),
  mongoose = require("mongoose"),
  MongoStore = require("connect-mongo").default,
  { createApp } = require("../dist/app"),
  { chromium } = require("playwright");
const results = path.join(__dirname, "../test-results");
fs.mkdirSync(results, { recursive: true });
(async () => {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  const store = MongoStore.create({ client: mongoose.connection.getClient() }),
    app = createApp({ secret: "e".repeat(48), store }),
    server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`,
    browser = await chromium.launch({ headless: true }),
    errors = [];
  const desktop = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    one = await desktop.newPage(),
    two = await mobile.newPage();
  for (const page of [one, two])
    page.on("pageerror", (error) => errors.push(error.message));
  async function signup(page, name) {
    await page.goto(base + "/register");
    await page
      .getByText("Ajouter mon nom (facultatif)", { exact: true })
      .click();
    await page.getByLabel("Nom (facultatif)", { exact: true }).fill(name);
    await page
      .getByLabel("Adresse email", { exact: true })
      .fill(name.toLowerCase() + "@example.test");
    await page.locator("#password").fill("Password1234");
    await page
      .getByRole("button", { name: "Afficher le mot de passe" })
      .click();
    assert.equal(await page.locator("#password").getAttribute("type"), "text");
    await page.getByRole("button", { name: "Masquer le mot de passe" }).click();
    await page
      .getByRole("button", { name: "Créer mon compte", exact: true })
      .click();
    await page.waitForURL("**/login");
    await page
      .getByLabel("Adresse email", { exact: true })
      .fill(name.toLowerCase() + "@example.test");
    await page.locator("#password").fill("Password1234");
    await page
      .getByRole("button", { name: "Ouvrir mon carnet", exact: true })
      .click();
    await page.waitForURL("**/businessCard");
  }
  try {
    for (const width of [320, 390, 800, 1440]) {
      await two.setViewportSize({ width, height: 900 });
      for (const route of ["/login", "/register", "/missing"]) {
        await two.goto(base + route);
        if (width === 390 && ["/login", "/register"].includes(route)) {
          const primary = await two
            .locator("form button[type=submit]")
            .boundingBox();
          assert.ok(primary && primary.y + primary.height <= 844);
        }

        assert.equal(
          await two.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          `${width} ${route}`,
        );
      }
    }
    await two.setViewportSize({ width: 390, height: 844 });
    await two.emulateMedia({ reducedMotion: "reduce" });
    await two.goto(base + "/login");
    await two.screenshot({
      path: path.join(results, "login-mobile.png"),
      fullPage: true,
    });
    await one.goto(base + "/login");
    await one.screenshot({
      path: path.join(results, "login-desktop.png"),
      fullPage: true,
    });
    await signup(one, "Camille");
    await signup(two, "Alex");
    const duplicate = await browser.newPage({
      viewport: { width: 320, height: 844 },
    });
    duplicate.on("pageerror", (error) => errors.push(error.message));
    await duplicate.goto(base + "/register");
    await duplicate.locator("#email").fill("name-check@example.test");
    await duplicate.locator("#password").fill("Password1234");
    await duplicate
      .getByText("Ajouter mon nom (facultatif)", { exact: true })
      .click();
    await duplicate.locator("#name").fill("x");
    await duplicate
      .locator("form")
      .evaluate((form) => (form.noValidate = true));
    await duplicate
      .getByRole("button", { name: "Créer mon compte", exact: true })
      .click();
    await duplicate
      .getByText("Le nom doit contenir de 2 à 80 caractères.", { exact: true })
      .first()
      .waitFor();
    assert.equal(
      await duplicate.locator("details.optional-profile").getAttribute("open"),
      "",
    );
    assert.equal(
      await duplicate.locator("#name").getAttribute("aria-invalid"),
      "true",
    );
    assert.equal(
      await duplicate.evaluate(() =>
        document.activeElement?.getAttribute("role"),
      ),
      "alert",
    );
    await duplicate.locator("#name").fill("");
    await duplicate.locator("#email").fill("alex@example.test");
    await duplicate.locator("#password").fill("Password1234");
    await duplicate
      .getByRole("button", { name: "Créer mon compte", exact: true })
      .click();
    await duplicate
      .getByText("Cet email est déjà utilisé.", { exact: true })
      .first()
      .waitFor();
    assert.equal(
      await duplicate.evaluate(() =>
        document.activeElement?.getAttribute("role"),
      ),
      "alert",
    );
    assert.equal(
      await duplicate.locator("#email").getAttribute("aria-invalid"),
      "true",
    );
    assert.equal(
      await duplicate.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await duplicate.close();

    await one
      .getByRole("link", { name: "Créer une carte", exact: true })
      .first()
      .click();
    await one.getByLabel("Nom complet", { exact: true }).fill("Camille Martin");
    await one
      .getByLabel("Entreprise (facultatif)", { exact: true })
      .fill("Studio des possibles");
    await one
      .getByLabel("Téléphone (facultatif)", { exact: true })
      .fill("+33 6 12 34 56 78");
    const creationKey = await one
      .locator('input[name="creationKey"]')
      .inputValue();
    const creationToken = await one
      .locator('input[name="_csrf"]')
      .first()
      .inputValue();
    let publications = 0;
    one.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/businessCard/addBusinessCard")
      )
        publications++;
    });
    await one.route("**/businessCard/addBusinessCard", async (route) => {
      if (route.request().method() === "POST")
        await new Promise((resolve) => setTimeout(resolve, 700));
      await route.continue();
    });
    const posting = one.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().endsWith("/businessCard/addBusinessCard"),
    );
    await one.waitForLoadState("load");
    assert.equal(
      await one.locator("main form").evaluate((form) => form.checkValidity()),
      true,
      "Le formulaire doit être valide avant de vérifier sa protection contre les doubles clics.",
    );
    const busy = await one
      .getByRole("button", { name: "Publier ma carte", exact: true })
      .evaluate((button) => {
        button.click();
        button.click();
        return {
          disabled: button.disabled,
          label: button.textContent,
          busy: button.getAttribute("aria-busy"),
        };
      });
    assert.deepEqual(busy, {
      disabled: true,
      label: "En cours…",
      busy: "true",
    });
    await posting;
    await one.waitForURL("**/businessCard/mine");
    await one.unroute("**/businessCard/addBusinessCard");
    await one.waitForURL("**/businessCard/mine");
    await one
      .getByRole("heading", { name: "Camille Martin", exact: true })
      .waitFor();
    const cardId = (
      await one
        .getByRole("link", {
          name: "Modifier la carte de Camille Martin",
          exact: true,
        })
        .getAttribute("href")
    ).split("/")[2];
    assert.equal(publications, 1);
    const replay = await Promise.all(
      Array.from({ length: 3 }, () =>
        one.request.post(base + "/businessCard/addBusinessCard", {
          form: {
            _csrf: creationToken,
            creationKey,
            name: "Camille Martin",
            companyName: "Studio des possibles",
            email: "camille@example.test",
            tel: "+33 6 12 34 56 78",
          },
        }),
      ),
    );
    assert.deepEqual(
      replay.map((response) => response.status()),
      [200, 200, 200],
    );
    await one.reload();
    assert.equal(await one.locator(".contact-card").count(), 1);
    await two.reload();
    await two
      .getByRole("heading", { name: "Camille Martin", exact: true })
      .waitFor();
    await two
      .getByRole("button", {
        name: "Garder la carte de Camille Martin",
        exact: true,
      })
      .click();
    await two.waitForURL("**/savedBusinessCard");
    await two.reload();
    await two
      .getByRole("heading", { name: "Camille Martin", exact: true })
      .waitFor();
    await two
      .getByRole("link", { name: "Organiser le contact Camille Martin" })
      .click();
    await two
      .getByLabel("Note personnelle", { exact: true })
      .fill("Rencontrée à la conférence TypeScript. À rappeler lundi.");
    await two.getByLabel("Étiquettes", { exact: true }).fill("dev, réseau");
    await two.getByLabel("Contact favori", { exact: true }).check();
    const oldNotes = await mobile.newPage();
    oldNotes.on("pageerror", (error) => errors.push(error.message));
    await oldNotes.goto(two.url());
    await two.getByRole("button", { name: "Enregistrer mes notes" }).click();
    await two.waitForURL("**/savedBusinessCard");
    await oldNotes
      .getByLabel("Note personnelle", { exact: true })
      .fill("Ancienne version");
    await oldNotes
      .getByRole("button", { name: "Enregistrer mes notes" })
      .click();
    await oldNotes
      .getByText(
        "Vos notes ont changé dans un autre onglet. Relisez-les avant d’enregistrer à nouveau.",
        { exact: true },
      )
      .waitFor();
    await oldNotes.close();
    await two.reload();
    await two
      .getByText("Rencontrée à la conférence TypeScript. À rappeler lundi.", {
        exact: true,
      })
      .waitFor();
    await two
      .getByRole("link", { name: "Organiser le contact Camille Martin" })
      .click();
    await two.locator("#note").fill("Modification annulée");
    await two.getByRole("link", { name: "Annuler", exact: true }).click();
    await two
      .getByText("Rencontrée à la conférence TypeScript. À rappeler lundi.", {
        exact: true,
      })
      .waitFor();
    await two.locator("#search").fill("TypeScript");
    await two.locator(".filter-tools summary").click();
    await two.locator("#tag-filter").selectOption("dev");
    await two.getByLabel("Favoris uniquement", { exact: true }).check();
    await two.getByRole("button", { name: "Rechercher", exact: true }).click();
    await two
      .getByRole("heading", { name: "Camille Martin", exact: true })
      .waitFor();
    const jsonDownload = two.waitForEvent("download");
    await two.getByText("Sauvegardes", { exact: true }).click();
    await two.getByRole("link", { name: "Exporter mon carnet .json" }).click();
    const jsonFile = await jsonDownload;
    await jsonFile.saveAs(path.join(results, "mon-carnet.json"));
    const exported = JSON.parse(
      fs.readFileSync(path.join(results, "mon-carnet.json"), "utf8"),
    );
    assert.equal(exported.contacts[0].favorite, true);
    assert.deepEqual(exported.contacts[0].tags, ["dev", "réseau"]);
    assert.match(exported.contacts[0].note, /TypeScript/);
    // La restauration passe par un vrai fichier, un aperçu sans mutation puis une transaction.
    await two.goto(base + "/businessCard/savedBusinessCard");
    await two
      .getByRole("button", {
        name: "Retirer la carte de Camille Martin",
        exact: true,
      })
      .click();
    await two.waitForURL("**/savedBusinessCard");
    await two.getByText("Sauvegardes", { exact: true }).click();
    await two
      .getByRole("link", { name: "Restaurer une sauvegarde", exact: true })
      .click();
    await two
      .locator("#backup-file")
      .setInputFiles(path.join(results, "mon-carnet.json"));
    await two
      .getByText("mon-carnet.json est prêt à être vérifié.", { exact: true })
      .waitFor();
    await two
      .getByRole("button", { name: "Vérifier la sauvegarde", exact: true })
      .click();
    await two
      .getByRole("heading", { name: "Vérifier les contacts", exact: true })
      .waitFor();
    const cancellation = await mobile.newPage();
    await cancellation.goto(base + "/businessCard/savedBusinessCard");
    assert.equal(await cancellation.locator(".contact-card").count(), 0);
    await cancellation.close();
    await two
      .getByRole("button", { name: "Restaurer ces contacts", exact: true })
      .click();
    await two.waitForURL("**/savedBusinessCard");
    await two.reload();
    await two
      .getByText("Rencontrée à la conférence TypeScript. À rappeler lundi.", {
        exact: true,
      })
      .waitFor();
    assert.equal(await two.locator(".contact-card").count(), 1);
    // Une vraie interruption réseau est distincte d’une fin normale de session.
    await mobile.setOffline(true);
    await two.evaluate(() => window.dispatchEvent(new Event("focus")));
    await two
      .getByText(
        "La connexion est interrompue. Votre page et vos données saisies sont conservées.",
        { exact: true },
      )
      .waitFor();
    assert.equal(await two.locator(".contact-card").count(), 1);
    await mobile.setOffline(false);
    await two.getByRole("button", { name: "Réessayer", exact: true }).click();
    await two.waitForFunction(
      () => document.getElementById("network-status").hidden,
    );
    await two.goto(base + "/businessCard/savedBusinessCard");
    await two.screenshot({
      path: path.join(results, "library-mobile.png"),
      fullPage: true,
    });
    await mobile.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: base,
    });
    await two
      .getByRole("button", {
        name: "Copier les coordonnées de Camille Martin",
        exact: true,
      })
      .click();
    await two.getByText("Coordonnées copiées.", { exact: true }).waitFor();
    assert.match(
      await two.evaluate(() => navigator.clipboard.readText()),
      /Camille Martin\ncamille@example.test\n\+33 6 12 34 56 78/,
    );
    const downloading = two.waitForEvent("download");
    await two
      .getByRole("link", {
        name: "Exporter la carte de Camille Martin",
        exact: true,
      })
      .click();
    const downloaded = await downloading;
    assert.match(downloaded.suggestedFilename(), /^contact-.+\.vcf$/);
    await downloaded.saveAs(path.join(results, "contact.vcf"));
    assert.match(
      fs.readFileSync(path.join(results, "contact.vcf"), "utf8"),
      /FN:Camille Martin/,
    );
    const token = await two.locator('input[name="_csrf"]').first().inputValue();
    assert.equal(
      (
        await two.request.post(base + `/businessCard/${cardId}/edit`, {
          form: {
            _csrf: token,
            name: "Forged",
            companyName: "",
            email: "forged@example.test",
            tel: "",
          },
        })
      ).status(),
      404,
    );
    await one
      .getByRole("link", {
        name: "Modifier la carte de Camille Martin",
        exact: true,
      })
      .click();
    const stale = await desktop.newPage();
    stale.on("pageerror", (error) => errors.push(error.message));
    await stale.goto(one.url());
    await one.getByLabel("Nom complet", { exact: true }).fill("Camille Dupont");
    await one
      .getByRole("button", { name: "Enregistrer la carte", exact: true })
      .click();
    await one.waitForURL("**/mine");
    await stale
      .getByLabel("Nom complet", { exact: true })
      .fill("Modification trop ancienne");
    await stale
      .getByRole("button", { name: "Enregistrer la carte", exact: true })
      .click();
    await stale
      .getByText(
        "La carte a changé dans un autre onglet. Vérifiez vos coordonnées avant d’enregistrer à nouveau.",
        { exact: true },
      )
      .waitFor();
    await stale.close();
    await two.reload();
    await two
      .getByRole("heading", { name: "Camille Dupont", exact: true })
      .waitFor();
    await one.goto(base + "/businessCard");
    await one.screenshot({
      path: path.join(results, "directory-desktop.png"),
      fullPage: true,
    });
    await one.goto(base + "/businessCard/mine");
    await one.screenshot({
      path: path.join(results, "cards-desktop.png"),
      fullPage: true,
    });
    await two.goto(base + "/businessCard");
    await two
      .getByLabel("Rechercher une carte", { exact: true })
      .fill("Studio des possibles");
    await two.getByRole("button", { name: "Rechercher", exact: true }).click();
    await two
      .getByRole("heading", { name: "Camille Dupont", exact: true })
      .waitFor();
    await two.getByLabel("Rechercher une carte", { exact: true }).fill(".*");
    await two.getByRole("button", { name: "Rechercher", exact: true }).click();
    await two
      .getByRole("heading", {
        name: "Aucune carte pour cette recherche",
        exact: true,
      })
      .waitFor();
    await two
      .getByRole("button", { name: "Ouvrir le menu", exact: true })
      .focus();
    await two.keyboard.press("Enter");
    assert.equal(
      await two
        .getByRole("button", { name: "Ouvrir le menu", exact: true })
        .getAttribute("aria-expanded"),
      "true",
    );
    const menuPaint = await two.locator("#site-nav").evaluate((nav) => {
      const rectangle = nav.getBoundingClientRect();
      const top = document.elementFromPoint(
        rectangle.left + 30,
        rectangle.top + 24,
      );
      return top === nav || nav.contains(top);
    });
    assert.equal(menuPaint, true, "le menu reste devant le contenu métier");
    await two.getByRole("button", { name: "Déconnexion", exact: true }).focus();
    await two.keyboard.press("Tab");
    assert.equal(
      await two
        .getByRole("button", { name: "Ouvrir le menu", exact: true })
        .evaluate((button) => document.activeElement === button),
      true,
    );
    await two.getByRole("link", { name: "Mon profil", exact: true }).click();
    await two.getByLabel("Nom complet", { exact: true }).fill("Alex Rivière");
    await two
      .getByRole("button", { name: "Enregistrer mon profil", exact: true })
      .click();
    await two
      .getByRole("heading", { name: "Alex Rivière", exact: true })
      .waitFor();
    for (const width of [320, 390, 800, 1440]) {
      await two.setViewportSize({ width, height: 900 });
      for (const route of [
        "/businessCard",
        "/businessCard/savedBusinessCard",
        "/businessCard/mine",
        "/businessCard/addBusinessCard",
        "/businessCard/import",
        `/businessCard/${cardId}/organize`,
      ]) {
        await two.goto(base + route);
        assert.equal(
          await two.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          `overflow ${width} ${route}`,
        );
      }
    }
    await two.setViewportSize({ width: 320, height: 900 });
    await two.goto(base + "/businessCard/savedBusinessCard");
    await two.screenshot({
      path: path.join(results, "library-320.png"),
      fullPage: true,
    });
    await one.goto(base + "/businessCard/mine");
    await one
      .getByRole("button", {
        name: "Supprimer la carte de Camille Dupont",
        exact: true,
      })
      .click();
    await one.getByRole("dialog").waitFor();
    assert.equal(
      await one
        .locator("#delete-cancel")
        .evaluate((node) => node === document.activeElement),
      true,
    );
    await one.screenshot({
      path: path.join(results, "delete-dialog.png"),
      fullPage: true,
    });
    await one.keyboard.press("Escape");
    await one
      .getByRole("heading", { name: "Camille Dupont", exact: true })
      .waitFor();
    await one
      .getByRole("button", {
        name: "Supprimer la carte de Camille Dupont",
        exact: true,
      })
      .click();
    await one
      .getByRole("button", { name: "Supprimer la carte", exact: true })
      .click();
    await one
      .getByRole("heading", {
        name: "Votre première carte vous attend.",
        exact: true,
      })
      .waitFor();
    await two.reload();
    await two
      .getByRole("heading", {
        name: "Gardez les contacts qui comptent.",
        exact: true,
      })
      .waitFor();
    await two
      .getByRole("button", { name: "Ouvrir le menu", exact: true })
      .click();
    await two.getByRole("button", { name: "Déconnexion", exact: true }).click();
    await two.waitForURL("**/login");
    await two.goto(base + "/businessCard");
    await two.waitForURL("**/login");
    // Les anciennes pages privées suivent les changements de session entre onglets.
    await one.goto(base + "/businessCard");
    const sibling = await desktop.newPage();
    sibling.on("pageerror", (error) => errors.push(error.message));
    await sibling.goto(base + "/businessCard/mine");
    await one.getByRole("button", { name: "Déconnexion", exact: true }).click();
    await one.waitForURL("**/login");
    await sibling.waitForURL("**/login", { timeout: 10000 });
    assert.equal(
      await sibling
        .getByRole("link", { name: "Mon profil", exact: true })
        .count(),
      0,
    );
    await one.locator("#email").fill("alex@example.test");
    await one.locator("#password").fill("Password1234");
    await one
      .getByRole("button", { name: "Ouvrir mon carnet", exact: true })
      .click();
    await one.waitForURL("**/businessCard");
    await sibling.waitForURL("**/businessCard", { timeout: 10000 });
    await sibling.getByText("Alex Rivière", { exact: true }).waitFor();
    await sibling.goto(
      base + (await one.locator("a[href^='/api/user/']").getAttribute("href")),
    );
    await sibling
      .getByLabel("Nom complet", { exact: true })
      .fill("Brouillon personnel Alex");
    let releaseSession, sessionCaptured;
    const heldSession = new Promise((resolve) => {
        releaseSession = resolve;
      }),
      capturedSession = new Promise((resolve) => {
        sessionCaptured = resolve;
      });
    let heldOnce = false;
    await sibling.route("**/session", async (route) => {
      if (heldOnce) return route.continue();
      heldOnce = true;
      const response = await route.fetch();
      sessionCaptured();
      await heldSession;
      await route.fulfill({ response });
    });
    await sibling.evaluate(() => window.dispatchEvent(new Event("focus")));
    await capturedSession;

    await one.getByRole("button", { name: "Déconnexion", exact: true }).click();
    await one.waitForURL("**/login");
    await sibling.evaluate(() => window.dispatchEvent(new Event("focus")));
    releaseSession();
    await sibling.waitForURL("**/login", { timeout: 2000 });
    await one.locator("#email").fill("camille@example.test");
    await one.locator("#password").fill("Password1234");
    await one
      .getByRole("button", { name: "Ouvrir mon carnet", exact: true })
      .click();
    await one.waitForURL("**/businessCard");
    await sibling.waitForURL("**/businessCard", { timeout: 10000 });
    await sibling.getByText("Camille", { exact: true }).waitFor();
    assert.equal(
      await sibling.getByText("Alex Rivière", { exact: true }).count(),
      0,
    );
    assert.ok(
      await sibling.evaluate(() =>
        Object.keys(sessionStorage).some(
          (key) =>
            key.startsWith("draft:") &&
            sessionStorage.getItem(key)?.includes("Brouillon personnel Alex"),
        ),
      ),
    );
    await one.getByRole("button", { name: "Déconnexion", exact: true }).click();
    await one.waitForURL("**/login");
    await sibling.waitForURL("**/login", { timeout: 10000 });
    await one.locator("#email").fill("alex@example.test");
    await one.locator("#password").fill("Password1234");
    await one
      .getByRole("button", { name: "Ouvrir mon carnet", exact: true })
      .click();
    await one.waitForURL("**/businessCard");
    await sibling.waitForURL("**/businessCard", { timeout: 10000 });
    await sibling.goto(
      base + (await one.locator("a[href^='/api/user/']").getAttribute("href")),
    );
    assert.equal(
      await sibling.getByLabel("Nom complet", { exact: true }).inputValue(),
      "Brouillon personnel Alex",
    );
    await sibling.close();
    const shortApp = createApp({
        secret: "e".repeat(48),
        store,
        sessionDurationMs: 1600,
      }),
      shortServer = shortApp.listen(0, "127.0.0.1");
    await new Promise((resolve) => shortServer.on("listening", resolve));
    const shortUrl = `http://127.0.0.1:${shortServer.address().port}`;
    const shortContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
      }),
      expiring = await shortContext.newPage();
    await expiring.goto(shortUrl + "/login");
    await expiring.locator("#email").fill("alex@example.test");
    await expiring.locator("#password").fill("Password1234");
    await expiring
      .getByRole("button", { name: "Ouvrir mon carnet", exact: true })
      .click();
    await expiring.waitForURL("**/businessCard");
    await expiring.waitForURL("**/login", { timeout: 10000 });
    assert.equal(
      await expiring
        .getByRole("link", { name: "Mon profil", exact: true })
        .count(),
      0,
    );
    await shortContext.close();
    await new Promise((resolve) => shortServer.close(resolve));
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          widths: [320, 390, 800, 1440],
          flows: [
            "register errors",
            "login",
            "publish double click and replay",
            "stale edit conflict",
            "library persistence",
            "private notes tags favorites",
            "stale annotation conflict",
            "private search filters",
            "personal JSON export",
            "private backup file preview and restoration",
            "network interruption retry without losing private content",
            "vcard download",
            "native clipboard copy of contact coordinates",
            "ownership",
            "edit propagates",
            "search literal",
            "profile",
            "keyboard menu",
            "delete cancel and confirm",
            "library cleanup",
            "logout",
            "cross-tab logout login account replacement and expiration",
          ],
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await one.screenshot({
      path: path.join(results, "failure-desktop.png"),
      fullPage: true,
    });
    await two.screenshot({
      path: path.join(results, "failure-mobile.png"),
      fullPage: true,
    });
    throw error;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await store.close();
    await mongoose.disconnect();
    await mongo.stop();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
