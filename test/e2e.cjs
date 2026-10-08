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
    await page.getByLabel("Nom complet", { exact: true }).fill(name);
    await page
      .getByLabel("Entreprise (facultatif)", { exact: true })
      .fill("Atelier indépendant");
    await page
      .getByLabel("Adresse email", { exact: true })
      .fill(name.toLowerCase() + "@example.test");
    await page
      .getByLabel("Téléphone (facultatif)", { exact: true })
      .fill("+33 6 12 34 56 78");
    await page.locator("#password").fill("Password1234");
    await page.locator("#confirmPassword").fill("Mismatch1234");
    await page
      .getByRole("button", { name: "Créer mon compte", exact: true })
      .click();
    await page
      .getByText("Les mots de passe ne correspondent pas.", { exact: true })
      .first()
      .waitFor();
    await page.locator("#password").fill("Password1234");
    await page.locator("#confirmPassword").fill("Password1234");
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
    await one
      .getByRole("link", { name: "Créer une carte", exact: true })
      .first()
      .click();
    await one.getByLabel("Nom complet", { exact: true }).fill("Camille Martin");
    await one
      .getByLabel("Entreprise (facultatif)", { exact: true })
      .fill("Studio des possibles");
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
    await two.screenshot({
      path: path.join(results, "library-mobile.png"),
      fullPage: true,
    });
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
            "vcard download",
            "ownership",
            "edit propagates",
            "search literal",
            "profile",
            "keyboard menu",
            "delete cancel and confirm",
            "library cleanup",
            "logout",
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
