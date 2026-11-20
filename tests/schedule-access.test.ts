import { test } from "node:test";
import assert from "node:assert/strict";
import { guard } from "../src/core/routes";
import { canSchedule } from "../src/core/services";
import type { Actor, Profile } from "../src/core/types";

const person = (role: Profile["role"], schedule_access?: boolean): Profile => ({
  id: "u1", email: "k@example.com", phone: null, full_name: "Kaan", role, emergency_contact: "", status: "active", onboarded: true, schedule_access, created_at: "2026-11-01T00:00:00Z",
});
const actor = (p: Profile): Actor => ({ auth_id: p.id, identifier: p.email, user: p });

test("a coach with schedule access gets only the Community Schedule in Admin", () => {
  const kaan = actor(person("coach", true));
  assert.equal(canSchedule(kaan.user), true);
  for (const path of ["/admin", "/admin?tab=draft", "/admin/sessions/new", "/admin/sessions/abc"]) assert.equal(guard("admin", kaan, path), null, path);
  for (const path of ["/admin/coaches", "/admin/members", "/admin/members/abc", "/admin/settings"]) assert.equal(guard("admin", kaan, path), "/admin", path);
});

test("other coaches and members still can't open Admin", () => {
  const coach = actor(person("coach"));
  assert.equal(canSchedule(coach.user), false);
  assert.equal(guard("admin", coach, "/admin"), "/coach");
  // Schedule access means nothing unless the person is a coach.
  const member = actor(person("member", true));
  assert.equal(canSchedule(member.user), false);
  assert.equal(guard("admin", member, "/admin"), "/schedule");
  assert.equal(guard("admin", actor(person("admin")), "/admin/settings"), null);
});
