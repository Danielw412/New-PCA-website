import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

test("registration outcome copy and attendee summaries read plainly", () => {
	assert.equal(registration.registrationOutcomeCopy("confirmed", 1), "Your attendee is confirmed.");
	assert.equal(registration.registrationOutcomeCopy("confirmed", 3), "Your group of 3 is confirmed.");
	assert.match(registration.registrationOutcomeCopy("waitlisted", 2), /^Your group of 2 is on the waitlist\./);
	assert.equal(registration.attendeeSummaryLine({ full_name: "Mei Chen", attendee_type: "child", age: 9, school_district: "PPS" }), "Mei Chen (age 9, PPS)");
	assert.equal(registration.attendeeSummaryLine({ full_name: "Lin Chen", attendee_type: "adult" }), "Lin Chen (adult)");
	assert.equal(administration.attendeeInlineSummary({ full_name: "Old Record", grade: "4" }), "Old Record (grade 4)");
});

test("event rail summaries count seats, waiting groups, and upcoming state", () => {
	const now = new Date("2026-09-13T12:00:00Z");
	const event = { id: "event-a", title: "Festival", capacity: 50, starts_at: "2026-09-26T18:00:00Z", ends_at: "2026-09-26T20:00:00Z", deleted_at: null };
	const registrations = [
		{ event_id: "event-a", status: "confirmed", participant_count: 3 },
		{ event_id: "event-a", status: "confirmed", participant_count: 2 },
		{ event_id: "event-a", status: "waitlisted", participant_count: 4 },
		{ event_id: "event-a", status: "cancelled", participant_count: 1 },
		{ event_id: "event-b", status: "confirmed", participant_count: 9 },
	];
	const summary = administration.summarizeEventRegistrations(event, registrations, now);
	assert.equal(summary.confirmedSeats, 5);
	assert.equal(summary.confirmedGroups, 2);
	assert.equal(summary.waitlistedGroups, 1);
	assert.equal(summary.cancelledGroups, 1);
	assert.equal(summary.totalGroups, 4);
	assert.equal(summary.upcoming, true);
	assert.equal(administration.summarizeEventRegistrations({ ...event, starts_at: "2026-01-01T18:00:00Z", ends_at: "2026-01-01T20:00:00Z" }, registrations, now).upcoming, false);
});

test("registration view links are hashed, scoped, and carried into confirmation emails", () => {
	const migration = read("supabase/migrations/20260913023208_registration_view_links_and_admin_queue.sql");
	assert.match(migration, /create table private\.registration_view_tokens/);
	assert.match(migration, /token_hash bytea not null unique/);
	assert.match(migration, /extensions\.digest\(pg_catalog\.convert_to\(raw_token, 'UTF8'\), 'sha256'\)/);
	assert.match(migration, /grant execute on function public\.get_registration_by_token\(text\) to anon, authenticated/);
	assert.match(migration, /grant execute on function public\.issue_registration_view_token\(uuid\) to authenticated/);
	assert.doesNotMatch(migration, /grant execute on function public\.issue_registration_view_token\(uuid\) to anon/);
	assert.match(migration, /owner_id is distinct from caller_id and not private\.is_site_administrator\(caller_id\)/);
	assert.match(migration, /'view_token', private\.issue_registration_view_token\(p_resource_id\)/);
	assert.match(migration, /'event_waitlist_promoted'[\s\S]*?'view_token', private\.issue_registration_view_token\(waiting_registration\.id\)/);
	assert.match(migration, /grant execute on function public\.admin_email_queue_summary\(\) to authenticated/);
	assert.match(migration, /if not private\.is_site_administrator\(\) then[\s\S]*?transactional_email_deliveries/);

	const edgeSource = read("supabase/functions/pca-transactional-email/index.ts");
	assert.match(edgeSource, /registration\.html\?token=\$\{token\}/);
	assert.match(edgeSource, /\/\^\[0-9a-f\]\{64\}\$\/\.test\(token\)/);
	assert.match(edgeSource, /configured: providerConfigured/);

	const registrationSource = read("assets/js/modules/events-registration.js");
	assert.match(registrationSource, /get_registration_by_token/);
	assert.match(registrationSource, /get_my_event_registration/);
	assert.ok(existsSync(resolve(root, "registration.html")));
	assert.match(read("registration.html"), /data-registration-view/);
});

test("one-time code sign-in uses existing accounts only and carries the captcha token", () => {
	const backend = read("assets/js/pca-backend.js");
	assert.match(backend, /signInWithOtp\(\{[\s\S]*?shouldCreateUser:\s*false/);
	assert.match(backend, /verifyOtp\(\{ email: otpEmail, token, type: "email" \}\)/);
	assert.match(read("assets/js/pca-auth-captcha.js"), /wrapCredentialsMethod\("signInWithOtp"\)/);
	const login = read("login.html");
	assert.match(login, /data-otp-request-form/);
	assert.match(login, /data-otp-verify-form/);
	assert.match(login, /autocomplete="one-time-code"/);
});

test("the administration workspace never blocks on native browser dialogs", () => {
	const adminSource = read("assets/js/modules/administration.js");
	assert.doesNotMatch(adminSource, /window\.(?:prompt|alert)\(/);
	assert.doesNotMatch(adminSource, /\bconfirm\(`/);
	assert.match(adminSource, /confirmDialog\(\{[\s\S]*?title: `Cancel /);
	assert.match(adminSource, /event_registration_attendees[\s\S]*?\.in\("registration_id", ids\)/);
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
