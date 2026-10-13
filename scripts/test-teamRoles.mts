import assert from "node:assert/strict";
import express from "express";
import { MemoryCoreRepository } from "../server/core/memoryRepository";
import {
  registerTeamRoleRoutes,
  teamRoleRegistry,
  type TeamRoleSnapshot,
} from "../server/core/collaboration/teamRoles";
import { registerParticipantRoutes } from "../server/core/collaboration/routes";
const repo = new MemoryCoreRepository();
await repo.upsertProject({
  id: "book-t82",
  ownerId: "owner",
  title: "Test book",
});
const deps = {
  getBookOwnerId: async () => "owner",
  getCollabOwnerId: async () => undefined,
  listAcceptedInvites: async () => [],
};
const version = teamRoleRegistry().version;
let disabled = false,
  unregistered = false,
  changed = false,
  calls = 0;
let snapshot: TeamRoleSnapshot = {
  teamId: "team-1",
  revision: 1,
  members: [
    {
      id: "member-1",
      firebaseUid: "firebase-member",
      name: "Member",
      roles: [
        {
          id: "assignment-1",
          roleId: "editor",
          specialization: null,
          registryVersion: version,
        },
      ],
    },
  ],
};
const app = express();
app.use(express.json());
app.use((q, _r, n) => {
  const id = q.headers["x-user"] as string;
  if (id) (q as any).principal = { id, isGuest: false, role: "writer" };
  n();
});
registerTeamRoleRoutes(app, {
  repo: () => repo,
  access: deps,
  identity: async () => ({ firebaseUid: "firebase-owner" }),
  findUser: async () => (unregistered ? undefined : { id: "member", disabled }),
  fetchTeam: async (_q, id) => {
    calls++;
    if (id === "foreign") throw Error("not owned");
    const s = structuredClone(snapshot);
    if (changed && calls % 2 === 0) s.revision++;
    return s;
  },
});
registerParticipantRoutes(app, { repo: () => repo, access: deps });
const s = app.listen(0, "127.0.0.1");
await new Promise((r) => s.once("listening", r));
const root = `http://127.0.0.1:${(s.address() as any).port}`;
let count = 0;
const test = async (name: string, fn: () => Promise<void>) => {
  await fn();
  count++;
  console.log("✓ " + name);
};
const b = () => ({
  teamId: "team-1",
  memberId: "member-1",
  assignmentId: "assignment-1",
  expectedRevision: 1,
  registryVersion: version,
  confirmed: true,
});
const post = (op: string, body: any, who = "owner") =>
  fetch(root + "/api/core/projects/book-t82/team-roles/" + op, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(who ? { "x-user": who } : {}),
    },
    body: JSON.stringify(body),
  });
try {
  await test("Public registry contains canonical roles and no private book data", async () => {
    const r = await fetch(root + "/api/collaboration/team-role-registry");
    const j = await r.json();
    assert.equal(j.version, version);
    assert.ok(j.roles.some((x: any) => x.id === "editor"));
    assert.ok(!JSON.stringify(j).includes("book-t82"));
  });
  await test("Guest/outsider cannot preview or import", async () => {
    assert.equal((await post("preview", b(), "")).status, 401);
    assert.equal((await post("import", b(), "other")).status, 403);
    assert.equal(calls, 0);
  });
  await test("Course project cannot bypass book role compatibility",async()=>{
    await repo.upsertProject({id:"book-t82",ownerId:"owner",projectType:"course",title:"Course"});
    assert.equal((await post("preview",{teamId:"team-1"})).status,422);
    await repo.upsertProject({id:"book-t82",ownerId:"owner",projectType:"book",title:"Book"});
  });
  await test("Preview makes no participant or grant", async () => {
    assert.equal((await post("preview", { teamId: "team-1" })).status, 200);
    assert.equal((await repo.listParticipants("book-t82")).length, 0);
    assert.equal(
      (await repo.listAccessGrants({ projectId: "book-t82" })).length,
      0,
    );
  });
  await test("Explicit confirmation, current team and registry are required", async () => {
    assert.equal(
      (await post("import", { ...b(), confirmed: false })).status,
      422,
    );
    assert.equal(
      (await post("import", { ...b(), expectedRevision: 0 })).status,
      409,
    );
    assert.equal(
      (await post("import", { ...b(), registryVersion: "old" })).status,
      409,
    );
  });
  await test("Foreign team, missing assignment and mismatched snapshot rejected", async () => {
    assert.equal((await post("preview", { teamId: "foreign" })).status, 502);
    assert.equal(
      (await post("import", { ...b(), assignmentId: "absent" })).status,
      409,
    );
    assert.equal((await post("preview", { teamId: "team-2" })).status, 502);
  });
  await test("No unregistered/disabled Studio identity is assigned", async () => {
    unregistered = true;
    assert.equal((await post("import", b())).status, 422);
    unregistered = false;
    disabled = true;
    assert.equal((await post("import", b())).status, 422);
    disabled = false;
  });
  await test("Ownership and unsupported roles are never imported", async () => {
    snapshot.members[0].roles[0].roleId = "project_owner";
    assert.equal((await post("import", b())).status, 422);
    snapshot.members[0].roles[0].roleId = "absent";
    assert.equal((await post("import", b())).status, 422);
    snapshot.members[0].roles[0].roleId = "editor";
  });
  await test("Revocation/change during remote IO rejects late assignment", async () => {
    changed = true;
    calls = 0;
    assert.equal((await post("import", b())).status, 409);
    changed = false;
    assert.equal((await repo.listParticipants("book-t82")).length, 0);
  });
  await test("Confirmed import assigns one role with team provenance and NO Access Grant", async () => {
    const r = await post("import", b());
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.role.roleId, "editor");
    assert.equal(j.permissionsGranted, false);
    assert.equal(
      (await repo.listAccessGrants({ projectId: "book-t82" })).length,
      0,
    );
    const events = await repo.listCollabEvents("book-t82");
    assert.ok(events.some((e) => e.details.source === "steam_team"));
  });
  await test("Repeat does not duplicate roles; imported role does not let member read book", async () => {
    assert.equal((await post("import", b())).status, 200);
    assert.equal(
      (
        await repo.listParticipantRoles({
          projectId: "book-t82",
          status: "active",
        })
      ).length,
      1,
    );
    assert.equal(
      (
        await fetch(root + "/api/core/projects/book-t82/participants", {
          headers: { "x-user": "member" },
        })
      ).status,
      403,
    );
  });
  await test("Book owner revokes imported role using existing role API", async () => {
    const roles = await repo.listParticipantRoles({
      projectId: "book-t82",
      status: "active",
    });
    const r = await fetch(
      root + "/api/core/projects/book-t82/participants/roles/" + roles[0].id,
      { method: "DELETE", headers: { "x-user": "owner" } },
    );
    assert.equal(r.status, 200);
    assert.equal(
      (
        await repo.listParticipantRoles({
          projectId: "book-t82",
          status: "active",
        })
      ).length,
      0,
    );
  });
  console.log(`Підсумок: ${count} пройшло, 0 впало.`);
} finally {
  await new Promise<void>((r) => s.close(() => r()));
}
