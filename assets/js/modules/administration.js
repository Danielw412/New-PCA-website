import {
	createElement,
	formatShortDate,
	friendlyError,
	getAccountContext,
	getSession,
	platformReady,
	setFormBusy,
	setStatus,
} from "./core-auth.js?v=20260830-past-events-v1";

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

const easternCalendarDateFormatter = new Intl.DateTimeFormat("sv-SE", {
	timeZone: "America/New_York",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
});

const eventDateInputValue = (event) => event.event_date || (event.starts_at ? easternCalendarDateFormatter.format(new Date(event.starts_at)) : "");
const eventDateTableValue = (event) => event.event_date
	? formatShortDate(`${event.event_date}T12:00:00Z`)
	: event.starts_at
		? formatShortDate(event.starts_at)
		: "—";

export const checkinEligibility = (registration) => {
	if (!registration) return { allowed: false, reason: "missing" };
	if (registration.checked_in_at) return { allowed: false, reason: "already_checked_in" };
	if (registration.event_deleted_at) return { allowed: false, reason: "archived" };
	if (registration.registration_status !== "confirmed") return { allowed: false, reason: "not_confirmed" };
	return { allowed: true, reason: null };
};

const requestTransactionalEmail = async (supabase, kind, resourceId) => {
	if (!resourceId) return;
	const { error } = await supabase.functions.invoke("pca-transactional-email", {
		body: { kind, resource_id: resourceId },
	});
	if (error) console.warn(`The ${kind} email could not be dispatched immediately.`, error);
};

const eventStateLabel = (event) => {
	if (!event.published) return "Draft";
	const now = new Date();
	if (event.ends_at && new Date(event.ends_at) < now) return "Past";
	if (event.starts_at && new Date(event.starts_at) <= now) return "In progress";
	if (!event.starts_at && event.event_date && event.event_date <= easternCalendarDateFormatter.format(now)) return "Past";
	return "Upcoming";
};

export const prepareAdministrationShell = () => {
	const page = document.querySelector("[data-platform-admin]");
	if (!page || page.querySelector('[data-admin-tab="volunteers"]')) return;
	const tabs = page.querySelector(".pca-admin-workspace-tabs");
	const publishingGroup = [...page.querySelectorAll(".pca-admin-tab-group")].find((group) => group.textContent.trim() === "Publishing");
	const teenPanel = page.querySelector('[data-admin-panel="teen-members"]');
	const volunteerForm = teenPanel?.querySelector("[data-admin-volunteer-assignment-form]");
	const firstVolunteerNode = volunteerForm?.closest("details");
	if (!tabs || !publishingGroup || !teenPanel || !firstVolunteerNode) return;

	const tab = createElement("button", "button small", "Volunteers");
	tab.id = "admin-tab-volunteers";
	tab.type = "button";
	tab.setAttribute("role", "tab");
	tab.setAttribute("aria-selected", "false");
	tab.setAttribute("aria-controls", "admin-panel-volunteers");
	tab.tabIndex = -1;
	tab.dataset.adminTab = "volunteers";
	tabs.insertBefore(tab, publishingGroup);

	const panel = createElement("section", "pca-admin-workspace-panel");
	panel.id = "admin-panel-volunteers";
	panel.setAttribute("role", "tabpanel");
	panel.setAttribute("aria-labelledby", tab.id);
	panel.dataset.adminPanel = "volunteers";
	panel.hidden = true;
	panel.append(
		createElement("h2", "", "Volunteer Operations"),
		createElement("p", "", "Create event assignments, update volunteer status, and review submitted service hours in one focused queue.")
	);
	let node = firstVolunteerNode;
	while (node) {
		const next = node.nextElementSibling;
		panel.appendChild(node);
		node = next;
	}
	const content = page.querySelector(".pca-admin-workspace-content");
	content.insertBefore(panel, page.querySelector('[data-admin-panel="blog"]'));
};

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
		["events", "events", (query) => query.is("deleted_at", null)],
		["event_registrations", "registrations"],
		["account_profiles", "households", (query) => query.eq("account_type", "household")],
		["volunteer_applications", "volunteer-applications", (query) => query.eq("status", "pending")],
		["event_volunteer_requests", "volunteer-requests", (query) => query.eq("status", "pending")],
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
	const { data: events, error } = await supabase.from("events").select("*").is("deleted_at", null).order("event_date", { ascending: false }).order("starts_at", { ascending: false, nullsFirst: false });
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
			form.elements.location.value = event.location || "";
			form.elements.event_date.value = eventDateInputValue(event);
			const localValue = (iso) => iso ? new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(" ", "T") : "";
			form.elements.starts_at.value = localValue(event.starts_at);
			form.elements.ends_at.value = localValue(event.ends_at);
			form.elements.capacity.value = event.capacity;
			form.elements.max_participants_per_registration.value = event.max_participants_per_registration;
			form.elements.registration_open.checked = event.registration_open;
			form.elements.published.checked = event.published;
			form.scrollIntoView({ behavior: "smooth", block: "start" });
		});
		actions.appendChild(edit);
		const remove = createElement("button", "button small pca-button-danger", "Delete Event");
		remove.type = "button";
		remove.addEventListener("click", async () => {
			if (!window.confirm(`Delete “${event.title}” from the website? Existing registrations and volunteer records will be retained.`)) return;
			remove.disabled = true;
			const { error: deleteError } = await supabase.rpc("delete_event", { p_event_id: event.id });
			if (deleteError) {
				remove.disabled = false;
				window.alert(friendlyError(deleteError));
			} else await Promise.all([loadEvents(page, supabase), loadOverview(page, supabase)]);
		});
		actions.appendChild(remove);
		row.append(tableCell(event.title), tableCell(eventDateTableValue(event)), tableCell(event.location), tableCell(eventStateLabel(event)), actions);
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
			const startsAt = String(values.get("starts_at") || "").trim();
			const endsAt = String(values.get("ends_at") || "").trim();
			if ((startsAt && !endsAt) || (!startsAt && endsAt)) throw new Error("Enter both start and end times, or leave both blank.");
			payload = {
				title: String(values.get("title") || "").trim(),
				description: String(values.get("description") || "").trim(),
				location: String(values.get("location") || "").trim() || null,
				event_date: String(values.get("event_date") || "").trim(),
				starts_at: startsAt ? easternDateTimeToIso(startsAt) : null,
				ends_at: endsAt ? easternDateTimeToIso(endsAt) : null,
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
		void supabase.functions.invoke("pca-transactional-email", { body: { retry_promotions: true } })
			.then(({ error: promotionError }) => {
				if (promotionError) console.debug("Waitlist promotion email remains queued.", promotionError);
			});
	});
	page.querySelector("[data-admin-event-clear]").addEventListener("click", () => { form.reset(); form.elements.event_id.value = ""; });
};

const loadRegistrations = async (page, supabase) => {
	const [registrationResult, eventsResult, profilesResult] = await Promise.all([
		supabase.from("event_registrations").select("*").order("created_at", { ascending: false }),
		supabase.from("events").select("id,title,starts_at,ends_at,event_date,deleted_at"),
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
		if (registration.status === "confirmed" && !event?.deleted_at && new Date(event?.ends_at).getTime() + 7 * 24 * 60 * 60 * 1000 > Date.now()) {
			const checkIn = createElement("button", "button small", "Check In");
			checkIn.type = "button";
			checkIn.addEventListener("click", async () => {
				if (!window.confirm(`Record arrival for ${registration.contact_name || "this attendee group"}?`)) return;
				checkIn.disabled = true;
				const { data, error } = await supabase.rpc("check_in_registration_as_admin", { p_registration_id: registration.id });
				checkIn.disabled = false;
				if (error || !data) {
					window.alert(friendlyError(error, "Check-in could not be recorded."));
					return;
				}
				window.alert(data.already_checked_in ? "This group was already checked in." : "Attendance recorded.");
			});
			actions.appendChild(checkIn);
		}
		if (registration.status !== "cancelled") {
			const cancel = createElement("button", "button small", "Cancel");
			cancel.type = "button";
			cancel.addEventListener("click", async () => {
				if (!window.confirm("Cancel this registration and run waitlist promotion?")) return;
				const { error } = await supabase.rpc("cancel_event_registration", { p_registration_id: registration.id });
				if (error) window.alert(friendlyError(error));
				else {
					void supabase.functions.invoke("pca-transactional-email", { body: { retry_promotions: true } })
						.then(({ error: promotionError }) => {
							if (promotionError) console.debug("A waitlist notification remains safely queued.", promotionError);
						});
					await loadRegistrations(page, supabase);
				}
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

const deleteManagedAccount = async (supabase, profile, reload) => {
	if (!profile?.id) return;
	const confirmed = window.confirm(`Permanently delete ${profile.full_name}'s PCA account? This removes the login, profile, saved household or volunteer records, and cannot be undone.`);
	if (!confirmed) return;
	const { error } = await supabase.rpc("delete_account_as_admin", { p_target_user_id: profile.id });
	if (error) {
		window.alert(friendlyError(error, "The account could not be deleted."));
		return;
	}
	await reload();
};

const initializeCheckinTool = (page, supabase) => {
	const form = page.querySelector("[data-admin-checkin-form]");
	if (!form) return;
	const status = page.querySelector("[data-admin-checkin-status]");
	const result = page.querySelector("[data-admin-checkin-result]");
	const tokenInput = form.elements.token;
	let currentToken = "";

	const clearResult = () => {
		currentToken = "";
		result.replaceChildren();
		result.hidden = true;
	};

	const renderResult = (registration, checkedIn = false) => {
		result.replaceChildren();
		const title = createElement("h3", "", registration.event_title || "Event registration");
		const meta = createElement("p", "", `${formatShortDate(registration.starts_at)} · ${registration.location || "Location not listed"}`);
		const contact = createElement("p", "", `${registration.contact_name || "Primary contact"} · ${registration.participant_count || 0} attendee${Number(registration.participant_count) === 1 ? "" : "s"}`);
		const attendees = createElement("ul", "pca-compact-list");
		(registration.attendees || []).forEach((attendee) => attendees.appendChild(createElement("li", "", attendee.full_name)));
		const state = createElement("p", "pca-backend-status", registration.checked_in_at
			? `Checked in${checkedIn ? " now" : " previously"}.`
			: "Registration found. Confirm the attendee names before checking in.");
		const eligibility = checkinEligibility(registration);
		const eligible = eligibility.allowed;
		if (!eligible && !registration.checked_in_at) {
			state.textContent = registration.event_deleted_at
				? "This event is archived and cannot accept check-ins."
				: "This registration is not confirmed and cannot be checked in.";
		}
		state.classList.add(registration.checked_in_at ? "is-success" : eligible ? "is-info" : "is-error");
		result.append(title, meta, contact, attendees, state);
		if (!registration.checked_in_at && eligible) {
			const lookedUpToken = currentToken;
			const confirm = createElement("button", "button primary", "Record Check-in");
			confirm.type = "button";
			confirm.addEventListener("click", async () => {
				if (!window.confirm(`Record arrival for ${registration.contact_name || "this attendee group"}?`)) return;
				confirm.disabled = true;
				const { data, error } = await supabase.rpc("check_in_event_registration", { p_token: lookedUpToken });
				if (error || !data) {
					confirm.disabled = false;
					setStatus(status, friendlyError(error, "Check-in could not be recorded."), "error");
					return;
				}
				renderResult(data, true);
				setStatus(status, "Attendance recorded.", "success");
			});
			result.appendChild(confirm);
		}
		result.hidden = false;
	};

	tokenInput.addEventListener("input", () => {
		clearResult();
		setStatus(status);
	});

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		const submittedToken = String(new FormData(form).get("token") || "").trim().toLowerCase();
		if (!/^[0-9a-f]{64}$/.test(submittedToken)) {
			setStatus(status, "Enter the complete 64-character check-in code.", "error");
			return;
		}
		clearResult();
		currentToken = submittedToken;
		setFormBusy(form, true, "Finding...");
		setStatus(status, "Finding the registration...", "info");
		const { data, error } = await supabase.rpc("lookup_registration_checkin", { p_token: currentToken });
		setFormBusy(form, false);
		if (error || !data) {
			setStatus(status, friendlyError(error, "No active registration matches that code."), "error");
			return;
		}
		renderResult(data);
		setStatus(status);
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
			const actions = createElement("td", "pca-admin-row-actions");
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
			const removeAccount = createElement("button", "button small pca-button-danger", "Delete Account");
			removeAccount.type = "button";
			removeAccount.addEventListener("click", () => deleteManagedAccount(supabase, profile, async () => {
				memberPanel.hidden = true;
				await loadHouseholds(page, supabase);
			}));
			actions.append(edit, members, reset, removeAccount);
			row.append(tableCell(profile.full_name), tableCell(profile.contact_email || profile.email), tableCell(profile.contact_phone), actions);
			body.appendChild(row);
		});
	};
	search.addEventListener("input", render);
	render();
};

const loadVolunteerAccounts = async (page, supabase) => {
	const [applicationsResult, profilesResult, rolesResult] = await Promise.all([
		supabase.from("volunteer_applications").select("id,user_id,age,phone,school_name,status,admin_notes,submitted_at,reviewed_at").order("submitted_at", { ascending: false }),
		supabase.from("account_profiles").select("id,full_name,email,account_type").eq("account_type", "teen_member").order("full_name"),
		supabase.from("teen_member_role_assignments").select("user_id,role,revoked_at").is("revoked_at", null),
	]);
	for (const result of [applicationsResult, profilesResult, rolesResult]) if (result.error) throw result.error;
	const applications = new Map(applicationsResult.data.map((application) => [application.user_id, application]));
	const body = page.querySelector("[data-admin-teens-body]");
	body.replaceChildren();
	profilesResult.data.forEach((profile) => {
		const application = applications.get(profile.id);
		const currentRoles = new Set(rolesResult.data.filter((role) => role.user_id === profile.id).map((role) => role.role));
		const row = createElement("tr");
		const roles = createElement("td", "pca-role-cell");
		["student_council", "editor", "volunteer"].forEach((role) => {
			const label = createElement("label", "pca-inline-check");
			const checkbox = createElement("input");
			checkbox.type = "checkbox";
			checkbox.value = role;
			checkbox.checked = currentRoles.has(role);
			checkbox.disabled = application?.status !== "approved";
			label.append(checkbox, document.createTextNode(` ${role.replace("_", " ")}`));
			roles.appendChild(label);
		});
		const actions = createElement("td", "pca-admin-row-actions");
		if (application?.status === "pending") {
			["approved", "rejected"].forEach((decision) => {
				const button = createElement("button", `button small${decision === "approved" ? " primary" : ""}`, decision === "approved" ? "Approve" : "Reject");
				button.type = "button";
				button.addEventListener("click", async () => {
					const notes = window.prompt("Administrator notes (optional)", application.admin_notes || "");
					if (notes === null) return;
					const { error } = await supabase.rpc("review_volunteer_account_application", { p_application_id: application.id, p_decision: decision, p_admin_notes: notes });
					if (error) window.alert(friendlyError(error));
					else {
						if (decision === "approved") await requestTransactionalEmail(supabase, "volunteer_account_approved", application.id);
						await loadVolunteerAccounts(page, supabase);
					}
				});
				actions.appendChild(button);
			});
		} else if (application?.status === "approved") {
			const saveRoles = createElement("button", "button small", "Save Roles");
			saveRoles.type = "button";
			saveRoles.addEventListener("click", async () => {
				const selected = [...roles.querySelectorAll('input:checked')].map((input) => input.value);
				const { error } = await supabase.rpc("replace_teen_member_roles", { p_user_id: profile.id, p_roles: selected });
				window.alert(error ? friendlyError(error) : "Roles saved.");
			});
			actions.appendChild(saveRoles);
		}
		const removeAccount = createElement("button", "button small pca-button-danger", "Delete Account");
		removeAccount.type = "button";
		removeAccount.addEventListener("click", () => deleteManagedAccount(supabase, profile, () => loadVolunteerAccounts(page, supabase)));
		actions.appendChild(removeAccount);
		row.append(
			tableCell(profile.full_name),
			tableCell(profile.email),
			tableCell(application?.age ?? "—"),
			tableCell(application?.school_name || "—"),
			tableCell(application?.phone || "—"),
			tableCell(application?.status || "Application details needed"),
			roles,
			actions
		);
		body.appendChild(row);
	});
	if (!profilesResult.data.length) {
		const row = createElement("tr");
		const empty = createElement("td", "pca-admin-empty", "No Volunteer Accounts have been created yet.");
		empty.colSpan = 8;
		row.appendChild(empty);
		body.appendChild(row);
	}
};

const loadVolunteerRequests = async (page, supabase) => {
	const body = page.querySelector("[data-admin-volunteer-requests-body]");
	if (!body) return;
	const [requestsResult, eventsResult] = await Promise.all([
		supabase.from("event_volunteer_requests").select("*").order("submitted_at", { ascending: false }),
		supabase.from("events").select("id,title,starts_at,event_date"),
	]);
	if (requestsResult.error) throw requestsResult.error;
	if (eventsResult.error) throw eventsResult.error;
	const events = new Map((eventsResult.data || []).map((event) => [event.id, event]));
	body.replaceChildren();
	(requestsResult.data || []).forEach((request) => {
		const row = createElement("tr");
		const event = events.get(request.event_id);
		const details = createElement("td", "pca-admin-volunteer-request-details");
		details.appendChild(createElement("strong", "", request.full_name));
		details.appendChild(createElement("span", "", request.email));
		if (request.phone) details.appendChild(createElement("span", "", request.phone));
		if (request.school_name) details.appendChild(createElement("span", "", request.school_name));
		const interests = createElement("td");
		interests.appendChild(createElement("p", "", request.interests || "No interests provided."));
		if (request.availability) interests.appendChild(createElement("small", "", `Availability: ${request.availability}`));
		const actions = createElement("td", "pca-admin-request-actions");
		if (request.status === "pending") {
			["approved", "rejected"].forEach((decision) => {
				const button = createElement("button", `button small${decision === "approved" ? " primary" : ""}`, decision === "approved" ? "Approve" : "Reject");
				button.type = "button";
				button.addEventListener("click", async () => {
					const notes = window.prompt(decision === "approved" ? "Approval message or instructions (optional)" : "Reason or notes (optional)", request.admin_notes || "");
					if (notes === null) return;
					button.disabled = true;
					const { error } = await supabase.rpc("review_event_volunteer_request", {
						p_request_id: request.id,
						p_decision: decision,
						p_admin_notes: notes,
					});
					if (error) {
						button.disabled = false;
						window.alert(friendlyError(error));
						return;
					}
					if (decision === "approved") await requestTransactionalEmail(supabase, "volunteer_request_approved", request.id);
					await Promise.all([loadVolunteerRequests(page, supabase), loadOverview(page, supabase)]);
				});
				actions.appendChild(button);
			});
		}
		row.append(
			details,
			tableCell(request.age),
			tableCell(event ? `${event.title} · ${formatShortDate(event.starts_at)}` : "Archived event"),
			interests,
			tableCell(request.future_event_emails ? "Yes" : "No"),
			tableCell(request.status),
			actions
		);
		body.appendChild(row);
	});
	if (!requestsResult.data?.length) {
		const row = createElement("tr");
		const empty = createElement("td", "pca-admin-empty", "No event volunteer requests yet.");
		empty.colSpan = 7;
		row.appendChild(empty);
		body.appendChild(row);
	}
};

const loadVolunteerManagement = async (page, supabase) => {
	const [profilesResult, rolesResult, eventsResult, assignmentsResult, hoursResult] = await Promise.all([
		supabase.from("account_profiles").select("id,full_name,email"),
		supabase.from("teen_member_role_assignments").select("user_id,role,revoked_at").eq("role", "volunteer").is("revoked_at", null),
		supabase.from("events").select("id,title,starts_at,event_date").is("deleted_at", null).order("event_date", { ascending: false }).order("starts_at", { ascending: false, nullsFirst: false }),
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
		const option = createElement("option", "", `${event.title} — ${eventDateTableValue(event)}`);
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
			const reviewForm = createElement("form", "pca-admin-hours-review");
			const hoursLabel = createElement("label", "", "Approved hours");
			const approvedHours = createElement("input");
			approvedHours.type = "number";
			approvedHours.min = "0";
			approvedHours.max = "24";
			approvedHours.step = "0.25";
			approvedHours.value = String(entry.submitted_hours);
			approvedHours.required = true;
			hoursLabel.appendChild(approvedHours);
			const notesLabel = createElement("label", "", "Notes");
			const notes = createElement("input");
			notes.type = "text";
			notes.maxLength = 2000;
			notes.placeholder = "Optional for approval";
			notesLabel.appendChild(notes);
			const buttonRow = createElement("div", "pca-admin-hours-review__actions");
			const approve = createElement("button", "button small", "Approve");
			approve.type = "submit";
			reviewForm.addEventListener("submit", async (event) => {
				event.preventDefault();
				const approved = Number(approvedHours.value);
				if (!Number.isFinite(approved)) return;
				setFormBusy(reviewForm, true, "Approving...");
				const { error } = await supabase.from("volunteer_service_hours").update({ status: "approved", approved_hours: approved, admin_notes: notes.value.trim() || null }).eq("id", entry.id);
				setFormBusy(reviewForm, false);
				if (error) window.alert(friendlyError(error));
				else await loadVolunteerManagement(page, supabase);
			});
			const reject = createElement("button", "button small", "Reject");
			reject.type = "button";
			reject.addEventListener("click", async () => {
				if (!notes.value.trim()) {
					notes.required = true;
					notes.reportValidity();
					return;
				}
				reject.disabled = true;
				const { error } = await supabase.from("volunteer_service_hours").update({ status: "rejected", approved_hours: null, admin_notes: notes.value.trim() }).eq("id", entry.id);
				if (error) window.alert(friendlyError(error));
				else await loadVolunteerManagement(page, supabase);
				reject.disabled = false;
			});
			buttonRow.append(approve, reject);
			reviewForm.append(hoursLabel, notesLabel, buttonRow);
			review.appendChild(reviewForm);
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
	const layout = page.querySelector(".pca-admin-dashboard-layout");
	if (layout) layout.hidden = false;
	page.querySelector("[data-admin-level]").textContent = context.admin_level === "super_admin" ? "Super Administrator" : "Administrator";
	initializeWorkspaceTabs(page);
	initializeEventForm(page, supabase);
	initializeCheckinTool(page, supabase);
	await Promise.all([
		loadOverview(page, supabase),
		loadEvents(page, supabase),
		loadRegistrations(page, supabase),
		loadHouseholds(page, supabase),
		loadVolunteerAccounts(page, supabase),
		loadVolunteerRequests(page, supabase),
		loadVolunteerManagement(page, supabase),
		loadAccess(page, supabase, context),
	]);
	void supabase.functions.invoke("pca-transactional-email", { body: { retry_queued: true } })
		.then(({ error }) => {
			if (error) console.debug("Queued email retry is not configured yet.", error);
		});
	setStatus(status);
};

export const initializeAdministrationPages = async () => {
	await initializeAdminWorkspace();
};
