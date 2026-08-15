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

test("check-in eligibility excludes stale and invalid registrations", () => {
	assert.deepEqual(administration.checkinEligibility(null), { allowed: false, reason: "missing" });
	assert.deepEqual(administration.checkinEligibility({ checked_in_at: "2026-08-12T10:00:00Z", registration_status: "confirmed", event_deleted_at: null }), { allowed: false, reason: "already_checked_in" });
	assert.deepEqual(administration.checkinEligibility({ checked_in_at: null, registration_status: "confirmed", event_deleted_at: "2026-08-01T10:00:00Z" }), { allowed: false, reason: "archived" });
	assert.deepEqual(administration.checkinEligibility({ checked_in_at: null, registration_status: "cancelled", event_deleted_at: null }), { allowed: false, reason: "not_confirmed" });
	assert.deepEqual(administration.checkinEligibility({ checked_in_at: null, registration_status: "confirmed", event_deleted_at: null }), { allowed: true, reason: null });
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

test("check-in and waitlist delivery paths stay fail-closed and race-resistant", () => {
	const adminSource = read("assets/js/modules/administration.js");
	const accountsSource = read("assets/js/modules/accounts.js");
	const registrationSource = read("assets/js/modules/events-registration.js");
	const edgeSource = read("supabase/functions/pca-transactional-email/index.ts");
	const migration = read("supabase/migrations/20260812061807_harden_event_capacity_email_and_checkin.sql");

	assert.match(adminSource, /tokenInput\.addEventListener\("input", \(\) => \{\s*clearResult\(\)/);
	assert.match(adminSource, /const lookedUpToken = currentToken/);
	assert.match(accountsSource, /cancel_event_registration[\s\S]*?retry_promotions/);
	assert.match(adminSource, /cancel_event_registration[\s\S]*?retry_promotions/);
	assert.match(registrationSource, /if \(registrationId\)[\s\S]*?retry_promotions/);
	assert.doesNotMatch(adminSource, /retry_queued[\s\S]{0,500}retry_promotions/);
	assert.match(edgeSource, /Idempotency-Key["`]:\s*`pca-email\/\$\{delivery\.id\}`/);
	assert.match(edgeSource, /if \(body\.retry_promotions\)[\s\S]*?auth\.getUser\(\)[\s\S]*?from\("admin_users"\)[\s\S]*?processClaimableDeliveries\("event_waitlist_promoted"\)/);
	assert.match(edgeSource, /sourceRegistration\.account_id !== userData\.user\.id/);
	assert.match(edgeSource, /processInitialEventPromotions\(eventId\)/);
	assert.match(migration, /token_digest bytea not null unique/);
	assert.match(migration, /deliveries\.attempts = 0/);
	assert.match(migration, /grant execute on function public\.list_initial_event_promotion_deliveries\(uuid, integer\)\s+to service_role/);
	assert.match(migration, /grant execute on function public\.check_in_event_registration\(text\)\s+to authenticated/);
	assert.match(migration, /grant execute on function public\.check_in_registration_as_admin\(uuid\)\s+to authenticated/);
});
