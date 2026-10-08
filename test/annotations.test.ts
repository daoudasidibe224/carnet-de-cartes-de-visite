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
test("notes privées, favoris, recherche, export et concurrence du carnet", async () => {
  const owner = await account("notes_owner"),
    reader = await account("notes_reader"),
    outsider = await account("notes_outside");
  await post(
    owner.agent,
    "/businessCard/addBusinessCard",
    values("ContactNotes"),
  );
  const card = await Card.findOne({ userId: owner.user.id });
  assert.ok(card);
  const url = `/businessCard/${card.id}/organize`;
  assert.equal((await reader.agent.get(url)).status, 404);
  await post(reader.agent, `/businessCard/${card.id}/save`);
  assert.equal(
    (
      await post(reader.agent, url, {
        revision: -1,
        note: "Rencontré au salon TypeScript",
        tags: "dev, À rappeler, dev",
        favorite: "on",
      })
    ).status,
    302,
  );
  const saved = await ContactAnnotation.findOne({
    userId: reader.user.id,
    cardId: card.id,
  });
  assert.ok(saved);
  assert.deepEqual(saved.tags, ["dev", "à rappeler"]);
  assert.equal(saved.favorite, true);
  assert.equal((await outsider.agent.get(url)).status, 404);
  assert.equal(
    (
      await post(outsider.agent, url, {
        revision: 0,
        note: "vol",
        tags: "",
        favorite: "on",
      })
    ).status,
    404,
  );
  const search = await reader.agent.get(
    "/businessCard/savedBusinessCard?q=TypeScript&favorites=1&tag=dev",
  );
  assert.match(search.text, /ContactNotes/);
  assert.match(search.text, /Rencontré au salon/);
  assert.doesNotMatch(
    (await owner.agent.get("/businessCard")).text,
    /Rencontré au salon/,
  );
  const exported = await reader.agent.get("/businessCard/export");
  assert.equal(exported.status, 200);
  assert.equal(exported.headers["cache-control"], "no-store");
  assert.deepEqual(exported.body.contacts[0].tags, ["dev", "à rappeler"]);
  assert.equal(exported.body.contacts[0].note, saved.note);
  assert.equal(
    (await outsider.agent.get("/businessCard/export")).body.contacts.length,
    0,
  );
  const results = await Promise.all([
    post(reader.agent, url, { revision: 0, note: "Premier", tags: "dev" }),
    post(reader.agent, url, { revision: 0, note: "Second", tags: "dev" }),
  ]);
  assert.deepEqual(results.map((value) => value.status).sort(), [302, 409]);
  assert.equal(
    (
      await ContactAnnotation.findOne({
        userId: reader.user.id,
        cardId: card.id,
      })
    )?.__v,
    1,
  );
  assert.equal(
    (
      await post(reader.agent, url, {
        revision: 1,
        note: "x".repeat(2001),
        tags: "",
      })
    ).status,
    422,
  );
  await post(reader.agent, `/businessCard/${card.id}/remove`);
  assert.equal(await ContactAnnotation.countDocuments({ cardId: card.id }), 0);
  assert.equal(
    (await post(reader.agent, url, { revision: 1, note: "late", tags: "" }))
      .status,
    404,
  );
  await post(reader.agent, `/businessCard/${card.id}/save`);
  await post(reader.agent, url, {
    revision: -1,
    note: "Suppression coordonnée",
    tags: "dev",
  });
  await post(owner.agent, `/businessCard/${card.id}/delete`);
  assert.equal(await ContactAnnotation.countDocuments({ cardId: card.id }), 0);
  assert.equal(
    (await User.findById(reader.user.id))?.library.includes(card.id),
    false,
  );
});

test("retirer un contact pendant une modification ne laisse aucune note orpheline", async () => {
  const owner = await account("race_owner"),
    reader = await account("race_reader");
  await post(owner.agent, "/businessCard/addBusinessCard", values("RaceNote"));
  const card = await Card.findOne({ userId: owner.user.id });
  assert.ok(card);
  await post(reader.agent, `/businessCard/${card.id}/save`);
  const results = await Promise.all([
    post(reader.agent, `/businessCard/${card.id}/organize`, {
      revision: -1,
      note: "Concurrent",
      tags: "dev",
    }),
    post(reader.agent, `/businessCard/${card.id}/remove`),
  ]);
  assert.ok([302, 404].includes(results[0]?.status || 0));
  assert.equal(results[1]?.status, 302);
  assert.equal(
    await ContactAnnotation.countDocuments({
      userId: reader.user.id,
      cardId: card.id,
    }),
    0,
  );
  assert.equal(
    (await User.findById(reader.user.id))?.library.includes(card.id),
    false,
  );
});

test("inscription minimale sans nom ni confirmation, session révoquée", async () => {
  const agent = request.agent(app),
    form = await agent.get("/register");
  assert.equal(
    (
      await agent
        .post("/api/user/register")
        .type("form")
        .send({
          _csrf: csrf(form.text),
          email: "minimal@example.test",
          password: "Password1234",
        })
    ).status,
    302,
  );
  const user = await User.findOne({ email: "minimal@example.test" });
  assert.equal(user?.name, "Membre");
  const page = await agent.get("/login");
  const login = await agent
    .post("/api/user/login")
    .type("form")
    .send({
      _csrf: csrf(page.text),
      email: "minimal@example.test",
      password: "Password1234",
    });
  const cookie = login.headers["set-cookie"][0].split(";")[0];
  const authenticated = await agent.get("/businessCard");
  await agent
    .post("/api/user/logout")
    .type("form")
    .send({ _csrf: csrf(authenticated.text) });
  assert.equal(
    (await request(app).get("/businessCard").set("Cookie", cookie)).headers
      .location,
    "/login",
  );
});

test("restauration privée après export et retrait, aperçu lié au compte, répétition sans doublon", async () => {
  const owner = await account("backup_owner"),
    reader = await account("backup_reader"),
    outsider = await account("backup_outsider");
  await post(
    owner.agent,
    "/businessCard/addBusinessCard",
    values("BackupContact"),
  );
  const card = await Card.findOne({ userId: owner.user.id });
  assert.ok(card);
  await post(reader.agent, `/businessCard/${card.id}/save`);
  await post(reader.agent, `/businessCard/${card.id}/organize`, {
    revision: -1,
    note: "Rencontre privée",
    tags: "design, à rappeler",
    favorite: "on",
  });
  const exported = await reader.agent.get("/businessCard/export");
  await post(reader.agent, `/businessCard/${card.id}/remove`);
  assert.equal((await User.findById(reader.user.id))?.library.length, 0);
  const preview = await post(reader.agent, "/businessCard/import/preview", {
    backup: exported.text,
  });
  assert.equal(preview.status, 200);
  const key = preview.text.match(/name="key" value="([^"]+)"/)?.[1];
  assert.ok(key);
  assert.equal(
    (await User.findById(reader.user.id))?.library.length,
    0,
    "aperçu sans écriture métier",
  );
  assert.equal(
    (await post(outsider.agent, "/businessCard/import/apply", { key })).status,
    409,
  );
  const results = await Promise.all([
    post(reader.agent, "/businessCard/import/apply", { key }),
    post(reader.agent, "/businessCard/import/apply", { key }),
  ]);
  assert.deepEqual(results.map((value) => value.status).sort(), [302, 409]);
  const restored = await ContactAnnotation.findOne({
    userId: reader.user.id,
    cardId: card.id,
  });
  assert.ok(restored);
  assert.equal(restored.note, "Rencontre privée");
  assert.deepEqual(restored.tags, ["design", "à rappeler"]);
  assert.equal(restored.favorite, true);
  assert.deepEqual((await User.findById(reader.user.id))?.library, [card.id]);
  assert.equal(
    await ContactAnnotation.countDocuments({ userId: reader.user.id }),
    1,
  );
  assert.equal(
    await ContactAnnotation.countDocuments({ userId: outsider.user.id }),
    0,
  );
  assert.doesNotMatch(
    (await owner.agent.get("/businessCard")).text,
    /Rencontre privée/,
  );
});

test("restauration refuse JSON invalide, surdimensionné, champs de propriété, inconnus et ambiguïtés sans écriture", async () => {
  const owner = await account("invalid_backup_owner"),
    reader = await account("invalid_backup_reader");
  const contact = {
    ...values("ImportTarget"),
    note: "",
    tags: [],
    favorite: false,
  };
  const invalid = [
    "{",
    JSON.stringify({ version: 2, contacts: [] }),
    JSON.stringify({
      version: 1,
      contacts: [{ ...contact, userId: owner.user.id }],
    }),
    JSON.stringify({ version: 1, contacts: Array(201).fill(contact) }),
    " ".repeat(512 * 1024 + 1),
    JSON.stringify({ version: 1, contacts: [contact] }),
  ];
  for (const backup of invalid)
    assert.equal(
      (await post(reader.agent, "/businessCard/import/preview", { backup }))
        .status,
      422,
    );
  await post(
    owner.agent,
    "/businessCard/addBusinessCard",
    values("ImportTarget"),
  );
  await post(
    owner.agent,
    "/businessCard/addBusinessCard",
    values("ImportTarget"),
  );
  const ambiguous = await post(reader.agent, "/businessCard/import/preview", {
    backup: JSON.stringify({ version: 1, contacts: [contact] }),
  });
  assert.equal(ambiguous.status, 422);
  assert.match(ambiguous.text, /Plusieurs cartes/);
  assert.deepEqual((await User.findById(reader.user.id))?.library, []);
  assert.equal(
    (await request(app).get("/businessCard/import")).headers.location,
    "/login",
  );
  assert.equal(
    (
      await reader.agent
        .post("/businessCard/import/preview")
        .type("form")
        .send({ backup: "{}" })
    ).status,
    403,
  );
});

test("restauration bloque une note différente et un changement après aperçu, sans restaurer partiellement", async () => {
  const owner = await account("conflict_backup_owner"),
    reader = await account("conflict_backup_reader");
  await post(
    owner.agent,
    "/businessCard/addBusinessCard",
    values("RestoreOne"),
  );
  await post(
    owner.agent,
    "/businessCard/addBusinessCard",
    values("RestoreTwo"),
  );
  const cards = await Card.find({ userId: owner.user.id }).sort({ name: 1 });
  assert.equal(cards.length, 2);
  const contacts = cards.map((card) => ({
    ...values(card.name),
    note: "Sauvegarde",
    tags: [],
    favorite: false,
  }));
  const preview = await post(reader.agent, "/businessCard/import/preview", {
    backup: JSON.stringify({ version: 1, contacts }),
  });
  assert.equal(preview.status, 200);
  const key = preview.text.match(/name="key" value="([^"]+)"/)?.[1];
  assert.ok(key);
  const second = cards[1];
  assert.ok(second);
  await post(owner.agent, `/businessCard/${second.id}/edit`, {
    ...values(second.name),
    companyName: "Modifié",
  });
  const changed = await post(reader.agent, "/businessCard/import/apply", {
    key,
  });
  assert.equal(changed.status, 409);
  assert.deepEqual((await User.findById(reader.user.id))?.library, []);
  assert.equal(
    await ContactAnnotation.countDocuments({ userId: reader.user.id }),
    0,
  );
  const first = cards[0];
  assert.ok(first);
  await post(reader.agent, `/businessCard/${first.id}/save`);
  await post(reader.agent, `/businessCard/${first.id}/organize`, {
    revision: -1,
    note: "Nouvelle note",
    tags: "",
  });
  const conflict = await post(reader.agent, "/businessCard/import/preview", {
    backup: JSON.stringify({ version: 1, contacts }),
  });
  assert.equal(conflict.status, 422);
  assert.match(conflict.text, /diffèrent/);
  assert.equal(
    (
      await ContactAnnotation.findOne({
        userId: reader.user.id,
        cardId: first.id,
      })
    )?.note,
    "Nouvelle note",
  );
});
