import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const registration = await import("../assets/js/modules/events-registration.js");
const administration = await import("../assets/js/modules/administration.js");
const accounts = await import("../assets/js/modules/accounts.js");
const emailTypoGuard = await import("../assets/js/modules/email-typo-guard.js");

test("registration referral details never leak a stale Other value", () => {
	assert.equal(registration.registrationReferralDetails("other", "  Community fair  "), "Community fair");
	assert.equal(registration.registrationReferralDetails("other", "   "), null);
	assert.equal(registration.registrationReferralDetails("website", "stale hidden value"), null);
});

test("registration edit links fail closed for missing, mismatched, cancelled, and started records", () => {
	const future = "2999-01-01T12:00:00Z";
	const past = "2000-01-01T12:00:00Z";
	const base = { event_id: "event-a", status: "confirmed" };
	assert.equal(registration.registrationEditAvailability({ registration: null, eventId: "event-a", eventStartsAt: future }), "missing");
	assert.equal(registration.registrationEditAvailability({ registration: base, eventId: "event-b", eventStartsAt: future }), "event_mismatch");
	assert.equal(registration.registrationEditAvailability({ registration: { ...base, status: "cancelled" }, eventId: "event-a", eventStartsAt: future }), "cancelled");
	assert.equal(registration.registrationEditAvailability({ registration: base, eventId: "event-a", eventStartsAt: past }), "started");
	assert.equal(registration.registrationEditAvailability({ registration: base, eventId: "event-a", eventStartsAt: past, isAdmin: true }), "editable");
});

test("saved attendees share one maximum and duplicate guard", () => {
	assert.deepEqual(registration.canAddRegistrationAttendee({ count: 2, maximum: 2 }), { allowed: false, reason: "maximum" });
	assert.deepEqual(registration.canAddRegistrationAttendee({ count: 1, maximum: 3, existingMemberIds: ["member-1"], householdMemberId: "member-1" }), { allowed: false, reason: "duplicate" });
	assert.deepEqual(registration.canAddRegistrationAttendee({ count: 1, maximum: 3, existingMemberIds: [], householdMemberId: "member-1" }), { allowed: true, reason: null });
});

test("administrators can review every collected registrant field", () => {
	const fields = new Map(administration.registrationDetailFields({
		id: "registration-1",
		registration_source: "guest",
		contact_name: "Ada Chen",
		contact_email: "ada@example.com",
		contact_phone: "412-555-0100",
		status: "waitlisted",
		participant_count: 2,
		referral_source: "other",
		referral_source_other: "Community fair",
		future_event_emails: true,
		created_at: "2026-09-01T16:00:00Z",
		updated_at: "2026-09-02T16:00:00Z",
		cancelled_at: null,
	}));
	assert.equal(fields.get("Contact phone"), "412-555-0100");
	assert.equal(fields.get("Registration status"), "On waitlist");
	assert.equal(fields.get("Heard about PCA from"), "Other: Community fair");
	assert.equal(fields.get("Future event emails"), "Yes");
	assert.equal(fields.get("PCA account"), "No permanent account");
	assert.match(fields.get("Registered"), /^Sep 1, 2026.* ET$/);
	assert.equal(fields.has("Cancelled"), false);

	assert.deepEqual(
		administration.attendeeDetailValues({ position: 1, full_name: "Mei Chen", attendee_type: "child", age: 9, school_district: "Pittsburgh Public Schools", grade: "4" }),
		[1, "Mei Chen", "Child / Youth", 9, "Pittsburgh Public Schools"]
	);
	assert.deepEqual(
		administration.attendeeDetailValues({ position: 2, full_name: "Lin Chen", attendee_type: "adult", age: null, school_district: null, grade: "4" }, true),
		[2, "Lin Chen", "Adult", null, null, "4"]
	);
});

test("email typo checks catch provider and domain slips without rejecting real domains", () => {
	const { checkEmailAddress } = emailTypoGuard;
	for (const [typed, suggestion] of [
		["parent@gmial.com", "parent@gmail.com"],
		["parent@yahooo.com", "parent@yahoo.com"],
		["parent@hotmail.co", "parent@hotmail.com"],
		["parent@outlok.com", "parent@outlook.com"],
		["parent@icloud.cm", "parent@icloud.com"],
	]) {
		assert.deepEqual(checkEmailAddress(typed), { status: "suggest", suggestion }, typed);
	}
	for (const [typed, suggestion] of [
		["parent@gmail.con", "parent@gmail.com"],
		["parent@pghschools.ogr", "parent@pghschools.org"],
		["parent@gmail", "parent@gmail.com"],
		["parent@gmailcom", "parent@gmail.com"],
	]) {
		const result = checkEmailAddress(typed);
		assert.equal(result.status, "invalid", typed);
		assert.equal(result.suggestion, suggestion, typed);
	}
	for (const typed of ["parent@gmail.com", " Parent@Pghschools.org ", "parent@yahoo.ca", "parent@gmx.net", "parent@mail.com", "student@andrew.cmu.edu", "parent@hotmail.co.uk"]) {
		assert.deepEqual(checkEmailAddress(typed), { status: "ok" }, typed);
	}
	assert.equal(checkEmailAddress("   ").status, "empty");
	assert.deepEqual(checkEmailAddress("parent.example.com"), { status: "invalid", message: "Enter a complete email address, like name@example.com.", suggestion: null });
	assert.equal(checkEmailAddress("parent@localhost").suggestion, null);
});

test("profile event records exclude deleted events before rendering or counting", () => {
	const records = [
		{ id: "registration-active", event_id: "event-active" },
		{ id: "registration-deleted", event_id: "event-deleted" },
		{ id: "registration-missing", event_id: "event-missing" },
	];
	const events = new Map([
		["event-active", { deleted_at: null }],
		["event-deleted", { deleted_at: "2026-07-31T00:14:11Z" }],
	]);

	assert.deepEqual(accounts.filterRecordsWithVisibleEvents(records, events), [records[0]]);
});

test("deleted events are excluded from registered and assigned user visibility", () => {
	const migration = read("supabase/migrations/20260815180354_hide_deleted_events_from_profiles.sql");
	assert.match(migration, /deleted_at is null[\s\S]*?registrations\.event_id = events\.id/);
	assert.match(migration, /deleted_at is null[\s\S]*?volunteer_assignments\.event_id = events\.id/);
	assert.match(migration, /private\.is_site_administrator\(\)/);
});

test("password updates retain the documented current-password field", () => {
	const backend = read("assets/js/pca-backend.js");
	assert.match(backend, /signInWithPassword\(\{[\s\S]*?password:\s*currentPassword[\s\S]*?\}\)/);
	assert.match(backend, /passwordUpdatePayload\(password,\s*currentPassword\)/);
	assert.match(backend, /current_password:\s*currentPassword/);
	assert.match(backend, /if \(error\)[\s\S]*?current_password[\s\S]*?value = ""/);
});

test("waitlist delivery paths stay fail-closed and race-resistant", () => {
	const adminSource = read("assets/js/modules/administration.js");
	const accountsSource = read("assets/js/modules/accounts.js");
	const registrationSource = read("assets/js/modules/events-registration.js");
	const edgeSource = read("supabase/functions/pca-transactional-email/index.ts");
	const migration = read("supabase/migrations/20260812061807_harden_event_capacity_email_and_checkin.sql");

	assert.match(accountsSource, /cancel_event_registration[\s\S]*?retry_promotions/);
	assert.match(adminSource, /cancel_event_registration[\s\S]*?retry_promotions/);
	assert.match(registrationSource, /if \(registrationId\)[\s\S]*?retry_promotions/);
	assert.doesNotMatch(adminSource, /retry_queued[\s\S]{0,500}retry_promotions/);
	assert.match(edgeSource, /Idempotency-Key["`]:\s*`pca-email\/\$\{delivery\.id\}`/);
	assert.match(edgeSource, /if \(body\.retry_promotions\)[\s\S]*?auth\.getUser\(\)[\s\S]*?from\("admin_users"\)[\s\S]*?processClaimableDeliveries\("event_waitlist_promoted"\)/);
	assert.match(edgeSource, /sourceRegistration\.account_id !== userData\.user\.id/);
	assert.match(edgeSource, /processInitialEventPromotions\(eventId\)/);
	assert.match(migration, /deliveries\.attempts = 0/);
	assert.match(migration, /grant execute on function public\.list_initial_event_promotion_deliveries\(uuid, integer\)\s+to service_role/);
});

test("the retired check-in system has no browser or database surface", () => {
	for (const file of [
		"admin-dashboard.html",
		"styles.css",
		"assets/js/modules/accounts.js",
		"assets/js/modules/administration.js",
		"assets/js/modules/events-registration.js",
	]) {
		assert.doesNotMatch(read(file), /check[-_ ]in|checkin(?!g)/i, `${file}: check-in code remains`);
	}

	const migration = read("supabase/migrations/20260913010510_remove_registration_checkin_system.sql");
	for (const signature of [
		"public.issue_registration_checkin_token(uuid)",
		"public.issue_guest_registration_checkin_token(uuid, text)",
		"public.lookup_registration_checkin(text)",
		"public.check_in_event_registration(text)",
		"public.check_in_registration_as_admin(uuid)",
		"private.issue_registration_checkin_token(uuid)",
		"private.issue_guest_registration_checkin_token(uuid, text)",
		"private.lookup_registration_checkin(text)",
		"private.check_in_event_registration(text)",
		"private.check_in_registration_as_admin(uuid)",
	]) {
		assert.ok(migration.includes(`drop function ${signature};`), `missing drop for ${signature}`);
	}
	assert.match(migration, /drop table private\.registration_checkins;/);
});
