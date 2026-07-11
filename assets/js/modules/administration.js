import {
	createElement,
	formatShortDate,
	friendlyError,
	getAccountContext,
	getSession,
	platformReady,
	setFormBusy,
	setStatus,
} from "./core-auth.js?v=20260711-guest-registration-v2";

const timeZonePartsFormatter = new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/New_York",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hourCycle: "h23",
});

const easternDateTimeToIso = (value) => {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
	if (!match) throw new Error("Choose a valid event date and time.");
	const requested = match.slice(1).map(Number);
	const localAsUtc = Date.UTC(requested[0], requested[1] - 1, requested[2], requested[3], requested[4], 0);
	const parts = (instant) => Object.fromEntries(timeZonePartsFormatter.formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
	const offset = (instant) => {
		const resolved = parts(instant);
		return Date.UTC(resolved.year, resolved.month - 1, resolved.day, resolved.hour, resolved.minute, resolved.second) - instant.getTime();
	};
	let utcTime = localAsUtc - offset(new Date(localAsUtc));
	utcTime = localAsUtc - offset(new Date(utcTime));
	const instant = new Date(utcTime);
	const resolved = parts(instant);
	if (resolved.year !== requested[0] || resolved.month !== requested[1] || resolved.day !== requested[2] || resolved.hour !== requested[3] || resolved.minute !== requested[4]) {
		throw new Error("That Eastern Time does not exist because of daylight saving time.");
	}
	return instant.toISOString();
};

const tableCell = (text) => createElement("td", "", text == null || text === "" ? "—" : String(text));

const initializeWorkspaceTabs = (page) => {
	const tabs = [...page.querySelectorAll("[data-admin-tab]")];
	const panels = [...page.querySelectorAll("[data-admin-panel]")];
	const show = (name) => {
		const selectedName = tabs.some((tab) => tab.dataset.adminTab === name) ? name : "overview";
		tabs.forEach((tab) => {
			const active = tab.dataset.adminTab === selectedName;
			tab.classList.toggle("primary", active);
			tab.classList.toggle("is-selected", active);
			tab.setAttribute("aria-selected", String(active));
			tab.tabIndex = active ? 0 : -1;
		});
		panels.forEach((panel) => { panel.hidden = panel.dataset.adminPanel !== selectedName; });
		window.history.replaceState(null, "", `#${selectedName}`);
	};
	tabs.forEach((tab, index) => {
		tab.addEventListener("click", () => show(tab.dataset.adminTab));
		tab.addEventListener("keydown", (event) => {
			let nextIndex = null;
			if (["ArrowDown", "ArrowRight"].includes(event.key)) nextIndex = (index + 1) % tabs.length;
			if (["ArrowUp", "ArrowLeft"].includes(event.key)) nextIndex = (index - 1 + tabs.length) % tabs.length;
			if (event.key === "Home") nextIndex = 0;
			if (event.key === "End") nextIndex = tabs.length - 1;
			if (nextIndex === null) return;
			event.preventDefault();
			show(tabs[nextIndex].dataset.adminTab);
			tabs[nextIndex].focus();
		});
	});
	show(window.location.hash.slice(1) || "overview");
};

const loadOverview = async (page, supabase) => {
	const resources = [
		["events", "events"],
		["event_registrations", "registrations"],
		["account_profiles", "households", (query) => query.eq("account_type", "household")],
		["teen_member_applications", "teen-applications", (query) => query.eq("status", "pending")],
		["blog_posts", "blog-posts"],
	];
	await Promise.all(resources.map(async ([table, hook, refine]) => {
		let query = supabase.from(table).select("*", { count: "exact", head: true });
		if (refine) query = refine(query);
		const { count, error } = await query;
		const target = page.querySelector(`[data-admin-count="${hook}"]`);
		if (target) target.textContent = error ? "—" : String(count ?? 0);
	}));
};

const loadEvents = async (page, supabase) => {
	const table = page.querySelector("[data-admin-events-body]");
	const { data: events, error } = await supabase.from("events").select("*").order("starts_at", { ascending: false });
	if (error) throw error;
	table.replaceChildren();
	(events || []).forEach((event) => {
		const row = createElement("tr");
		const actions = createElement("td");
		const edit = createElement("button", "button small", "Edit");
		edit.type = "button";
		edit.addEventListener("click", () => {
			const form = page.querySelector("[data-admin-event-form]");
			form.elements.event_id.value = event.id;
			form.elements.title.value = event.title;
			form.elements.description.value = event.description;
			form.elements.location.value = event.location;
			const localValue = (iso) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(" ", "T");
			form.elements.starts_at.value = localValue(event.starts_at);
			form.elements.ends_at.value = localValue(event.ends_at);
			form.elements.capacity.value = event.capacity;
			form.elements.max_participants_per_registration.value = event.max_participants_per_registration;
			form.elements.registration_open.checked = event.registration_open;
			form.elements.published.checked = event.published;
			form.scrollIntoView({ behavior: "smooth", block: "start" });
		});
		actions.appendChild(edit);
		if (!event.published) {
			const remove = createElement("button", "button small", "Delete Draft");
			remove.type = "button";
			remove.addEventListener("click", async () => {
				if (!window.confirm(`Delete the unused draft “${event.title}”?`)) return;
				const { error: deleteError } = await supabase.rpc("delete_event_draft", { p_event_id: event.id });
				if (deleteError) window.alert(friendlyError(deleteError));
				else await loadEvents(page, supabase);
			});
			actions.appendChild(remove);
		}
		row.append(tableCell(event.title), tableCell(formatShortDate(event.starts_at)), tableCell(event.location), tableCell(event.published ? "Published" : "Draft"), actions);
		table.appendChild(row);
	});
};

const initializeEventForm = (page, supabase) => {
	const form = page.querySelector("[data-admin-event-form]");
	const status = page.querySelector("[data-admin-event-status]");
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		const values = new FormData(form);
		let payload;
		try {
			payload = {
				title: String(values.get("title") || "").trim(),
				description: String(values.get("description") || "").trim(),
				location: String(values.get("location") || "").trim(),
				starts_at: easternDateTimeToIso(String(values.get("starts_at") || "")),
				ends_at: easternDateTimeToIso(String(values.get("ends_at") || "")),
				capacity: Number(values.get("capacity")),
				max_participants_per_registration: Number(values.get("max_participants_per_registration")),
				registration_open: values.has("registration_open"),
				published: values.has("published"),
			};
		} catch (error) {
			setStatus(status, error.message, "error");
			return;
		}
		setFormBusy(form, true, "Saving...");
		const { error } = await supabase.rpc("save_event", { p_event_id: values.get("event_id") || null, p_event: payload });
		setFormBusy(form, false);
		if (error) {
			setStatus(status, friendlyError(error, "The event could not be saved."), "error");
			return;
		}
		form.reset();
		form.elements.event_id.value = "";
		setStatus(status, "Event saved.", "success");
		await loadEvents(page, supabase);
	});
	page.querySelector("[data-admin-event-clear]").addEventListener("click", () => { form.reset(); form.elements.event_id.value = ""; });
};

const loadRegistrations = async (page, supabase) => {
	const [registrationResult, eventsResult, profilesResult] = await Promise.all([
		supabase.from("event_registrations").select("*").order("created_at", { ascending: false }),
		supabase.from("events").select("id,title,starts_at"),
		supabase.from("account_profiles").select("id,full_name,email"),
	]);
	for (const result of [registrationResult, eventsResult, profilesResult]) if (result.error) throw result.error;
	const events = new Map(eventsResult.data.map((event) => [event.id, event]));
	const profiles = new Map(profilesResult.data.map((profile) => [profile.id, profile]));
	const body = page.querySelector("[data-admin-registrations-body]");
	body.replaceChildren();
	registrationResult.data.forEach((registration) => {
		const event = events.get(registration.event_id);
		const profile = profiles.get(registration.owner_user_id);
		const row = createElement("tr");
		const actions = createElement("td");
		const edit = createElement("a", "button small", "Edit");
		edit.href = `register.html?event=${encodeURIComponent(registration.event_id)}&registration=${encodeURIComponent(registration.id)}`;
		actions.appendChild(edit);
		if (registration.status !== "cancelled") {
			const cancel = createElement("button", "button small", "Cancel");
			cancel.type = "button";
			cancel.addEventListener("click", async () => {
				if (!window.confirm("Cancel this registration and run waitlist promotion?")) return;
				const { error } = await supabase.rpc("cancel_event_registration", { p_registration_id: registration.id });
				if (error) window.alert(friendlyError(error));
				else await loadRegistrations(page, supabase);
			});
			actions.appendChild(cancel);
		}
		row.append(
			tableCell(event?.title || "Unknown event"),
			tableCell(registration.contact_name || profile?.full_name),
			tableCell(registration.contact_email || profile?.email),
			tableCell(registration.participant_count),
			tableCell(registration.status),
			tableCell(registration.registration_source),
			actions
		);
		body.appendChild(row);
	});
};

const loadHouseholds = async (page, supabase) => {
	const { data: profiles, error } = await supabase.from("account_profiles").select("*").eq("account_type", "household").order("full_name");
	if (error) throw error;
	const body = page.querySelector("[data-admin-households-body]");
	const search = page.querySelector("[data-admin-household-search]");
	const memberPanel = page.querySelector("[data-admin-household-members]");
	const showMembers = async (profile) => {
		const { data: members, error: memberError } = await supabase.from("household_members").select("*").eq("account_id", profile.id).order("created_at");
		if (memberError) throw memberError;
		memberPanel.hidden = false;
		memberPanel.replaceChildren(createElement("h3", "", `${profile.full_name} — Saved Members`));
		const grid = createElement("div", "pca-saved-member-grid");
		if (!members?.length) grid.appendChild(createElement("p", "pca-empty-state", "No saved members."));
		(members || []).forEach((member) => {
			const card = createElement("article", "pca-card pca-saved-member-card");
			card.append(createElement("h4", "", member.full_name), createElement("p", "", member.attendee_type === "child" ? `Age ${member.age} · ${member.school_district}` : "Adult"));
			const remove = createElement("button", "button small", "Remove");
			remove.type = "button";
			remove.addEventListener("click", async () => {
				if (!window.confirm(`Remove ${member.full_name} from this household?`)) return;
				const { error } = await supabase.from("household_members").delete().eq("id", member.id);
				if (error) window.alert(friendlyError(error));
				else await showMembers(profile);
			});
			card.appendChild(remove);
			grid.appendChild(card);
		});
		const add = createElement("button", "button", "Add Saved Member");
		add.type = "button";
		add.addEventListener("click", async () => {
			const name = window.prompt("Saved member full name");
			if (!name) return;
			const type = window.prompt("Type child or adult", "child")?.toLowerCase();
			if (!type || !["child", "adult"].includes(type)) return;
			const age = type === "child" ? Number(window.prompt("Age (0-25)", "10")) : null;
			const school = type === "child" ? window.prompt("School or district", "") : null;
			const { error } = await supabase.from("household_members").insert({ account_id: profile.id, full_name: name.trim(), attendee_type: type, age, school_district: school?.trim() || null, grade: null });
			if (error) window.alert(friendlyError(error));
			else await showMembers(profile);
		});
		memberPanel.append(grid, add);
		memberPanel.scrollIntoView({ behavior: "smooth", block: "start" });
	};
	const render = () => {
		const term = search.value.trim().toLowerCase();
		body.replaceChildren();
		profiles.filter((profile) => !term || `${profile.full_name} ${profile.email} ${profile.contact_email || ""}`.toLowerCase().includes(term)).forEach((profile) => {
			const row = createElement("tr");
			const actions = createElement("td");
			const edit = createElement("button", "button small", "Edit Contact");
			edit.type = "button";
			edit.addEventListener("click", async () => {
				const fullName = window.prompt("Household contact name", profile.full_name);
				if (fullName === null) return;
				const contactEmail = window.prompt("Contact email", profile.contact_email || profile.email);
				if (contactEmail === null) return;
				const phone = window.prompt("Contact phone", profile.contact_phone || "");
				if (phone === null) return;
				const { error: saveError } = await supabase.rpc("save_account_profile", { p_user_id: profile.id, p_full_name: fullName, p_contact_email: contactEmail, p_contact_phone: phone });
				if (saveError) window.alert(friendlyError(saveError));
				else await loadHouseholds(page, supabase);
			});
			const reset = createElement("button", "button small", "Send Password Reset");
			reset.type = "button";
			reset.addEventListener("click", async () => {
				const redirectTo = new URL("reset-password.html?mode=recovery", window.location.href).href;
				const { error: resetError } = await supabase.auth.resetPasswordForEmail(profile.email, { redirectTo });
				window.alert(resetError ? friendlyError(resetError) : "Password reset email requested.");
			});
			const members = createElement("button", "button small", "Saved Members");
			members.type = "button";
			members.addEventListener("click", () => showMembers(profile));
			actions.append(edit, members, reset);
			row.append(tableCell(profile.full_name), tableCell(profile.contact_email || profile.email), tableCell(profile.contact_phone), actions);
			body.appendChild(row);
		});
	};
	search.addEventListener("input", render);
	render();
};

const loadTeenMembers = async (page, supabase) => {
	const [applicationsResult, profilesResult, rolesResult] = await Promise.all([
		supabase.from("teen_member_applications").select("*").order("submitted_at", { ascending: false }),
		supabase.from("account_profiles").select("id,full_name,email"),
		supabase.from("teen_member_role_assignments").select("user_id,role,revoked_at").is("revoked_at", null),
	]);
	for (const result of [applicationsResult, profilesResult, rolesResult]) if (result.error) throw result.error;
	const profiles = new Map(profilesResult.data.map((profile) => [profile.id, profile]));
	const body = page.querySelector("[data-admin-teens-body]");
	body.replaceChildren();
	applicationsResult.data.forEach((application) => {
		const profile = profiles.get(application.user_id);
		const currentRoles = new Set(rolesResult.data.filter((role) => role.user_id === application.user_id).map((role) => role.role));
		const row = createElement("tr");
		const roles = createElement("td", "pca-role-cell");
		["student_council", "editor", "volunteer"].forEach((role) => {
			const label = createElement("label", "pca-inline-check");
			const checkbox = createElement("input");
			checkbox.type = "checkbox";
			checkbox.value = role;
			checkbox.checked = currentRoles.has(role);
			checkbox.disabled = application.status !== "approved";
			label.append(checkbox, document.createTextNode(` ${role.replace("_", " ")}`));
			roles.appendChild(label);
		});
		const actions = createElement("td");
		if (application.status === "pending") {
			["approved", "rejected"].forEach((decision) => {
				const button = createElement("button", "button small", decision === "approved" ? "Approve" : "Reject");
				button.type = "button";
				button.addEventListener("click", async () => {
					const notes = window.prompt("Administrator notes (optional)", application.admin_notes || "");
					if (notes === null) return;
					const { error } = await supabase.rpc("review_teen_member_application", { p_application_id: application.id, p_decision: decision, p_admin_notes: notes });
					if (error) window.alert(friendlyError(error));
					else await loadTeenMembers(page, supabase);
				});
				actions.appendChild(button);
			});
		} else if (application.status === "approved") {
			const saveRoles = createElement("button", "button small", "Save Roles");
			saveRoles.type = "button";
			saveRoles.addEventListener("click", async () => {
				const selected = [...roles.querySelectorAll('input:checked')].map((input) => input.value);
				const { error } = await supabase.rpc("replace_teen_member_roles", { p_user_id: application.user_id, p_roles: selected });
				window.alert(error ? friendlyError(error) : "Roles saved.");
			});
			actions.appendChild(saveRoles);
		}
		row.append(tableCell(profile?.full_name), tableCell(profile?.email), tableCell(application.age), tableCell(application.guardian_name), tableCell(application.status), roles, actions);
		body.appendChild(row);
	});
};

const loadVolunteerManagement = async (page, supabase) => {
	const [profilesResult, rolesResult, eventsResult, assignmentsResult, hoursResult] = await Promise.all([
		supabase.from("account_profiles").select("id,full_name,email"),
		supabase.from("teen_member_role_assignments").select("user_id,role,revoked_at").eq("role", "volunteer").is("revoked_at", null),
		supabase.from("events").select("id,title,starts_at").order("starts_at", { ascending: false }),
		supabase.from("event_volunteer_assignments").select("*").order("created_at", { ascending: false }),
		supabase.from("volunteer_service_hours").select("*").order("submitted_at", { ascending: false }),
	]);
	for (const result of [profilesResult, rolesResult, eventsResult, assignmentsResult, hoursResult]) if (result.error) throw result.error;
	const profiles = new Map(profilesResult.data.map((profile) => [profile.id, profile]));
	const events = new Map(eventsResult.data.map((event) => [event.id, event]));
	const assignments = new Map(assignmentsResult.data.map((assignment) => [assignment.id, assignment]));

	const form = page.querySelector("[data-admin-volunteer-assignment-form]");
	const volunteerSelect = form.elements.teen_member_user_id;
	const eventSelect = form.elements.event_id;
	volunteerSelect.replaceChildren(createElement("option", "", "Choose a volunteer"));
	eventSelect.replaceChildren(createElement("option", "", "Choose an event"));
	rolesResult.data.forEach((assignment) => {
		const profile = profiles.get(assignment.user_id);
		if (!profile) return;
		const option = createElement("option", "", profile.full_name);
		option.value = profile.id;
		volunteerSelect.appendChild(option);
	});
	eventsResult.data.forEach((event) => {
		const option = createElement("option", "", `${event.title} — ${formatShortDate(event.starts_at)}`);
		option.value = event.id;
		eventSelect.appendChild(option);
	});
	if (!form.dataset.bound) {
		form.dataset.bound = "true";
		form.addEventListener("submit", async (event) => {
			event.preventDefault();
			const values = new FormData(form);
			setFormBusy(form, true, "Creating...");
			const { error } = await supabase.from("event_volunteer_assignments").insert({
				teen_member_user_id: values.get("teen_member_user_id"),
				event_id: values.get("event_id"),
				role_title: String(values.get("role_title") || "").trim(),
				instructions: String(values.get("instructions") || "").trim(),
			});
			setFormBusy(form, false);
			setStatus(page.querySelector("[data-admin-volunteer-assignment-status]"), error ? friendlyError(error, "The assignment could not be created.") : "Volunteer assignment created.", error ? "error" : "success");
			if (!error) { form.reset(); await loadVolunteerManagement(page, supabase); }
		});
	}

	const assignmentBody = page.querySelector("[data-admin-volunteer-assignments-body]");
	assignmentBody.replaceChildren();
	assignmentsResult.data.forEach((assignment) => {
		const row = createElement("tr");
		const actions = createElement("td");
		const statusSelect = createElement("select");
		[["assigned", "Assigned"], ["completed", "Completed"], ["cancelled", "Cancelled"]].forEach(([value, label]) => {
			const option = createElement("option", "", label);
			option.value = value;
			option.selected = value === assignment.status;
			statusSelect.appendChild(option);
		});
		statusSelect.addEventListener("change", async () => {
			const { error } = await supabase.from("event_volunteer_assignments").update({ status: statusSelect.value }).eq("id", assignment.id);
			if (error) window.alert(friendlyError(error));
		});
		actions.appendChild(statusSelect);
		row.append(tableCell(profiles.get(assignment.teen_member_user_id)?.full_name), tableCell(events.get(assignment.event_id)?.title), tableCell(assignment.role_title), tableCell(assignment.status), actions);
		assignmentBody.appendChild(row);
	});

	const hoursBody = page.querySelector("[data-admin-volunteer-hours-body]");
	hoursBody.replaceChildren();
	hoursResult.data.forEach((entry) => {
		const row = createElement("tr");
		const review = createElement("td");
		if (entry.status === "submitted") {
			const approve = createElement("button", "button small", "Approve");
			approve.type = "button";
			approve.addEventListener("click", async () => {
				const approved = Number(window.prompt("Approved hours", String(entry.submitted_hours)));
				if (!Number.isFinite(approved)) return;
				const notes = window.prompt("Administrator notes (optional)", "");
				if (notes === null) return;
				const { error } = await supabase.from("volunteer_service_hours").update({ status: "approved", approved_hours: approved, admin_notes: notes }).eq("id", entry.id);
				if (error) window.alert(friendlyError(error));
				else await loadVolunteerManagement(page, supabase);
			});
			const reject = createElement("button", "button small", "Reject");
			reject.type = "button";
			reject.addEventListener("click", async () => {
				const notes = window.prompt("Reason for rejection", "");
				if (notes === null) return;
				const { error } = await supabase.from("volunteer_service_hours").update({ status: "rejected", approved_hours: null, admin_notes: notes }).eq("id", entry.id);
				if (error) window.alert(friendlyError(error));
				else await loadVolunteerManagement(page, supabase);
			});
			review.append(approve, reject);
		}
		const assignment = assignments.get(entry.assignment_id);
		row.append(tableCell(profiles.get(entry.teen_member_user_id)?.full_name), tableCell(formatShortDate(`${entry.service_date}T12:00:00`)), tableCell(entry.submitted_hours), tableCell(entry.description), tableCell(entry.status), review);
		if (assignment?.role_title) row.title = assignment.role_title;
		hoursBody.appendChild(row);
	});
};

const loadAccess = async (page, supabase, context) => {
	const panel = page.querySelector('[data-admin-panel="access"]');
	const tab = page.querySelector('[data-admin-tab="access"]');
	if (context.admin_level !== "super_admin") {
		panel.remove();
		tab.remove();
		return;
	}
	const [adminsResult, profilesResult] = await Promise.all([
		supabase.from("site_administrators").select("*").order("granted_at"),
		supabase.from("account_profiles").select("id,full_name,email").order("full_name"),
	]);
	if (adminsResult.error) throw adminsResult.error;
	if (profilesResult.error) throw profilesResult.error;
	const profiles = new Map(profilesResult.data.map((profile) => [profile.id, profile]));
	const body = page.querySelector("[data-admin-access-body]");
	body.replaceChildren();
	adminsResult.data.forEach((administrator) => {
		const profile = profiles.get(administrator.user_id);
		const row = createElement("tr");
		const actions = createElement("td");
		if (administrator.user_id !== context.user_id) {
			const remove = createElement("button", "button small", "Remove Access");
			remove.type = "button";
			remove.addEventListener("click", async () => {
				if (!window.confirm(`Remove administrator access from ${profile?.full_name || "this account"}?`)) return;
				const { error } = await supabase.rpc("demote_admin", { p_user_id: administrator.user_id });
				if (error) window.alert(friendlyError(error));
				else await loadAccess(page, supabase, context);
			});
			actions.appendChild(remove);
		}
		row.append(tableCell(profile?.full_name), tableCell(profile?.email), tableCell(administrator.access_level), actions);
		body.appendChild(row);
	});
	const form = page.querySelector("[data-admin-access-form]");
	const select = form.elements.user_id;
	select.replaceChildren(createElement("option", "", "Select an existing account"));
	profilesResult.data.filter((profile) => !adminsResult.data.some((admin) => admin.user_id === profile.id)).forEach((profile) => {
		const option = createElement("option", "", `${profile.full_name} — ${profile.email}`);
		option.value = profile.id;
		select.appendChild(option);
	});
	if (!form.dataset.bound) {
		form.dataset.bound = "true";
		form.addEventListener("submit", async (event) => {
			event.preventDefault();
			const values = new FormData(form);
			const { error } = await supabase.rpc("promote_account_to_admin", { p_user_id: values.get("user_id"), p_access_level: values.get("access_level") });
			if (error) window.alert(friendlyError(error));
			else await loadAccess(page, supabase, context);
		});
	}
};

const initializeAdminWorkspace = async () => {
	const page = document.querySelector("[data-platform-admin]");
	if (!page) return;
	const status = page.querySelector("[data-platform-admin-status]");
	const session = await getSession();
	if (!session) {
		window.location.replace(`login.html?next=${encodeURIComponent("admin-dashboard.html")}`);
		return;
	}
	const context = await getAccountContext();
	if (!context.admin_level) {
		setStatus(status, "Administrator access is required.", "error");
		return;
	}
	const { supabase } = await platformReady();
	page.querySelector("[data-admin-level]").textContent = context.admin_level === "super_admin" ? "Super Administrator" : "Administrator";
	initializeWorkspaceTabs(page);
	initializeEventForm(page, supabase);
	await Promise.all([
		loadOverview(page, supabase),
		loadEvents(page, supabase),
		loadRegistrations(page, supabase),
		loadHouseholds(page, supabase),
		loadTeenMembers(page, supabase),
		loadVolunteerManagement(page, supabase),
		loadAccess(page, supabase, context),
	]);
	setStatus(status);
};

export const initializeAdministrationPages = async () => {
	await initializeAdminWorkspace();
};
