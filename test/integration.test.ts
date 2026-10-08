import { randomUUID } from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import MongoStore from "connect-mongo";
import { createApp } from "../app";
import User from "../models/user.model";
import ContactAnnotation from "../models/contactAnnotation.model";
import CardCreation from "../models/cardCreation.model";
import Card from "../models/businessCard.model";
let mongo: MongoMemoryReplSet,
  app: ReturnType<typeof createApp>,
  store: MongoStore;
const csrf = (html: string) => {
  const token = html.match(/name="_csrf" value="([^"]+)"/)?.[1];
  assert.ok(token);
  return token;
};
const values = (name: string) => ({
  name,
  companyName: "Studio",
  email: `${name.toLowerCase().replace(/\W/g, "")}@example.test`,
  tel: "+33 6 12 34 56 78",
});
async function account(name: string) {
  const agent = request.agent(app),
    data = values(name);
  const register = await agent.get("/register");
  assert.equal(
    (
      await agent
        .post("/api/user/register")
        .type("form")
        .send({
          ...data,
          password: "Password1234",
          confirmPassword: "Password1234",
          _csrf: csrf(register.text),
        })
    ).status,
    302,
  );
  const login = await agent.get("/login");
  const response = await agent
    .post("/api/user/login")
    .type("form")
    .send({
      email: data.email,
      password: "Password1234",
      _csrf: csrf(login.text),
    });
  assert.equal(response.status, 302);
  const user = await User.findOne({ email: data.email });
  assert.ok(user);
  return {
    agent,
    user,
    cookie: response.headers["set-cookie"][0].split(";")[0],
  };
}
async function post(
  agent: ReturnType<typeof request.agent>,
  url: string,
  body: Record<string, unknown> = {},
) {
  const page = await agent.get("/businessCard");
  if (url === "/businessCard/addBusinessCard" && !body.creationKey)
    body.creationKey = randomUUID();
  if (/\/edit$/.test(url) && body.revision === undefined) {
    const form = await agent.get(url);
    body.revision =
      form.text.match(/name="revision" value="([^"]+)"/)?.[1] ?? "0";
  }
  return agent
    .post(url)
    .type("form")
    .send({ ...body, _csrf: csrf(page.text) });
}
before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri(), { serverSelectionTimeoutMS: 1000 });
  await Promise.all([
    User.init(),
    Card.init(),
    CardCreation.init(),
    ContactAnnotation.init(),
  ]);
  store = MongoStore.create({ client: mongoose.connection.getClient() });
  app = createApp({ secret: "x".repeat(48), store });
});
after(async () => {
  await store.close();
  await mongoose.disconnect();
  await mongo.stop();
});
test("accès, CSRF, validation et pages manquantes", async () => {
  assert.equal(
    (await request(app).get("/businessCard")).headers.location,
    "/login",
  );
  assert.equal(
    (await request(app).get("/api/user")).headers.location,
    "/login",
  );
  assert.equal(
    (await request(app).post("/api/user/register").send({})).status,
    403,
  );
  assert.equal((await request(app).get("/missing")).status, 404);
  const agent = request.agent(app),
    page = await agent.get("/register");
  const response = await agent
    .post("/api/user/register")
    .type("form")
    .send({
      _csrf: csrf(page.text),
      name: "A",
      email: "bad",
      password: "x",
      confirmPassword: "y",
    });
  assert.equal(response.status, 422);
  assert.match(response.text, /Les mots de passe ne correspondent pas/);
});
test("comptes uniques, hash, connexion incorrecte et session renouvelée", async () => {
  const a = await account("Alice");
  const hash = await User.findById(a.user.id).select("+password");
  assert.ok(hash);
  assert.notEqual(hash.password, "Password1234");
  const agent = request.agent(app),
    page = await agent.get("/login");
  const beforeCookie = page.headers["set-cookie"][0].split(";")[0];
  const wrong = await agent
    .post("/api/user/login")
    .type("form")
    .send({ _csrf: csrf(page.text), email: a.user.email, password: "wrong" });
  assert.equal(wrong.status, 401);
  const good = await agent
    .post("/api/user/login")
    .type("form")
    .send({
      _csrf: csrf(wrong.text),
      email: "ALICE@EXAMPLE.TEST",
      password: "Password1234",
    });
  assert.equal(good.status, 302);
  assert.notEqual(good.headers["set-cookie"][0].split(";")[0], beforeCookie);
  const duplicate = request.agent(app),
    form = await duplicate.get("/register");
  assert.equal(
    (
      await duplicate
        .post("/api/user/register")
        .type("form")
        .send({
          ...values("Alice"),
          password: "Password1234",
          confirmPassword: "Password1234",
          _csrf: csrf(form.text),
        })
    ).status,
    409,
  );
});
test("profil privé, modifications propres et conservation du mot de passe", async () => {
  const a = await account("Profil"),
    victim = await User.findOne({ name: "Alice" });
  assert.ok(victim);
  assert.equal((await a.agent.get(`/api/user/${victim.id}`)).status, 403);
  const data = await a.agent.get("/api/user");
  assert.equal(data.body.length, 1);
  assert.equal(data.body[0]._id, a.user.id);
  assert.equal(JSON.stringify(data.body).includes("password"), false);
  const hash = await User.findById(a.user.id).select("+password");
  assert.ok(hash);
  assert.equal(
    (
      await post(a.agent, "/api/user/profile", {
        ...values("Updated"),
        id: victim.id,
      })
    ).status,
    302,
  );
  const updated = await User.findById(a.user.id).select("+password");
  assert.ok(updated);
  assert.equal(updated.name, "Updated");
  assert.equal(updated.password, hash.password);
  assert.equal((await User.findById(victim.id))?.name, "Alice");
  assert.equal(
    (
      await post(a.agent, "/api/user/profile", {
        ...values("Updated"),
        email: "alice@example.test",
      })
    ).status,
    409,
  );
});
test("cartes appartenant à la session, édition et interdiction à un autre compte", async () => {
  const a = await account("Owner"),
    b = await account("Other");
  assert.equal(
    (
      await post(a.agent, "/businessCard/addBusinessCard", {
        ...values("Contact"),
        userId: b.user.id,
      })
    ).status,
    302,
  );
  const card = await Card.findOne({ name: "Contact" });
  assert.ok(card);
  assert.equal(card.userId, a.user.id);
  assert.equal(
    (await b.agent.get(`/businessCard/${card.id}/edit`)).status,
    404,
  );
  assert.equal(
    (await post(b.agent, `/businessCard/${card.id}/edit`, values("Forged")))
      .status,
    404,
  );
  assert.equal(
    (await post(b.agent, `/businessCard/${card.id}/delete`)).status,
    404,
  );
  assert.equal(
    (
      await post(a.agent, `/businessCard/${card.id}/edit`, {
        ...values("Edited"),
        email: "wrong",
      })
    ).status,
    422,
  );
  assert.equal(
    (await post(a.agent, `/businessCard/${card.id}/edit`, values("Edited")))
      .status,
    302,
  );
  assert.equal((await Card.findById(card.id))?.name, "Edited");
  assert.equal((await a.agent.get("/businessCard/not-an-id/edit")).status, 404);
});
test("bibliothèque idempotente, retrait et nettoyage transactionnel après suppression", async () => {
  const a = await account("Publisher"),
    b = await account("Collector");
  await post(a.agent, "/businessCard/addBusinessCard", values("Shared"));
  const card = await Card.findOne({ name: "Shared" });
  assert.ok(card);
  assert.equal(
    (await post(a.agent, `/businessCard/${card.id}/save`)).status,
    404,
  );
  await post(b.agent, `/businessCard/${card.id}/save`);
  await post(b.agent, `/businessCard/${card.id}/save`);
  assert.deepEqual((await User.findById(b.user.id))?.library, [card.id]);
  assert.match(
    (await b.agent.get("/businessCard/savedBusinessCard")).text,
    /Shared/,
  );
  await post(b.agent, `/businessCard/${card.id}/remove`);
  assert.deepEqual((await User.findById(b.user.id))?.library, []);
  await post(b.agent, `/businessCard/${card.id}/save`);
  await post(a.agent, `/businessCard/${card.id}/delete`);
  assert.equal(await Card.findById(card.id), null);
  assert.deepEqual((await User.findById(b.user.id))?.library, []);
  assert.equal(
    (await post(b.agent, `/businessCard/${card.id}/save`)).status,
    404,
  );
});
test("recherche littérale, pagination et export vCard échappé", async () => {
  const a = await account("SearchOwner"),
    b = await account("Reader");
  await Card.insertMany(
    Array.from({ length: 13 }, (_, i) => ({
      ...values(`Search${i}`),
      userId: a.user.id,
    })),
  );
  const card = await Card.create({
    ...values("A;B,C"),
    companyName: "Line\rBreak",
    userId: a.user.id,
  });
  const literal = await b.agent.get("/businessCard?q=.*");
  assert.match(literal.text, /Aucune carte pour cette recherche/);
  const search = await b.agent.get("/businessCard?q=Search");
  assert.equal((search.text.match(/class="contact-card/g) || []).length, 12);
  const next = await b.agent.get("/businessCard?q=Search&page=2");
  assert.equal((next.text.match(/class="contact-card/g) || []).length, 1);
  assert.equal((await b.agent.get("/businessCard?page[]=bad")).status, 200);
  const exported = await b.agent.get(`/businessCard/${card.id}/vcard`);
  assert.equal(exported.status, 200);
  assert.match(exported.headers["content-type"], /text\/vcard/);
  assert.match(exported.text, /FN:A\\;B\\,C/);
  assert.match(exported.text, /ORG:Line\\nBreak/);
  assert.match(exported.headers["content-disposition"], /attachment/);
});
test("profil, bibliothèque et session persistent après recréation du serveur, logout révoqué", async () => {
  const a = await account("Durable"),
    card = await Card.findOne({ name: "Search0" });
  assert.ok(card);
  await post(a.agent, `/businessCard/${card.id}/save`);
  const fresh = createApp({ secret: "x".repeat(48), store });
  const response = await request(fresh)
    .get("/businessCard/savedBusinessCard")
    .set("Cookie", a.cookie);
  assert.equal(response.status, 200);
  assert.match(response.text, /Search0/);
  const profile = await a.agent.get(`/api/user/${a.user.id}`);
  assert.equal(
    (
      await a.agent
        .post("/api/user/logout")
        .type("form")
        .send({ _csrf: csrf(profile.text) })
    ).status,
    302,
  );
  assert.equal(
    (await request(fresh).get("/businessCard").set("Cookie", a.cookie)).headers
      .location,
    "/login",
  );
});

test("un ajout concurrent à une suppression ne laisse aucune référence orpheline", async () => {
  const a = await account("ConcurrentOwner"),
    b = await account("ConcurrentReader");
  await post(a.agent, "/businessCard/addBusinessCard", values("Concurrent"));
  const card = await Card.findOne({ name: "Concurrent" });
  assert.ok(card);
  const [saved, deleted] = await Promise.all([
    post(b.agent, `/businessCard/${card.id}/save`),
    post(a.agent, `/businessCard/${card.id}/delete`),
  ]);
  assert.ok([302, 404].includes(saved.status));
  assert.equal(deleted.status, 302);
  assert.equal(await Card.findById(card.id), null);
  assert.deepEqual((await User.findById(b.user.id))?.library, []);
});
test("publication idempotente et édition concurrente sans écrasement silencieux", async () => {
  const owner = await account("DoubleAction");
  await owner.agent.get("/businessCard/addBusinessCard");
  const key = randomUUID(),
    payload = { ...values("Unique Card"), creationKey: key };
  const responses = await Promise.all(
    Array.from({ length: 5 }, () =>
      post(owner.agent, "/businessCard/addBusinessCard", payload),
    ),
  );
  assert.deepEqual(
    responses.map((response) => response.status),
    Array(5).fill(302),
  );
  const cards = await Card.find({ userId: owner.user.id });
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.ok(card);
  const changed = await post(owner.agent, "/businessCard/addBusinessCard", {
    ...payload,
    name: "Different Card",
  });
  assert.equal(changed.status, 409);
  const url = `/businessCard/${card.id}/edit`;
  const edits = await Promise.all([
    post(owner.agent, url, { ...values("Edit A"), revision: 0 }),
    post(owner.agent, url, { ...values("Edit B"), revision: 0 }),
  ]);
  assert.deepEqual(edits.map((response) => response.status).sort(), [302, 409]);
  assert.equal((await Card.findById(card.id))?.__v, 1);
  assert.match(
    edits.find((response) => response.status === 409)?.text ?? "",
    /autre onglet/,
  );
  assert.equal(
    (await post(owner.agent, `/businessCard/${card.id}/delete`)).status,
    302,
  );
  assert.equal(
    (await post(owner.agent, "/businessCard/addBusinessCard", payload)).status,
    409,
  );
  assert.equal(await Card.countDocuments({ userId: owner.user.id }), 0);
});
test("une base indisponible renvoie une erreur sans annoncer de sauvegarde", async () => {
  const a = await account("Unavailable");
  await mongo.stop();
  const response = await request(app)
    .get("/businessCard")
    .set("Cookie", a.cookie)
    .timeout(7000);
  assert.equal(response.status, 500);
  assert.match(response.text, /Une erreur est survenue/);
});
