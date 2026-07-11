import {
	createElement,
	formatEventRange,
	formatShortDate,
	friendlyError,
	getAccountContext,
	getSession,
	platformReady,
	requirePermanentAccount,
	setFormBusy,
	setStatus,
} from "./core-auth.js?v=20260711-spacing-rhythm";

const roleLabels = {
	student_council: "Student Council",
	editor: "Blog Editor",
	volunteer: "Volunteer",
};

const initializeTeenApplication = async () => {
	const page = document.querySelector("[data-teen-application-page]");
	if (!page) return;
	const form = page.querySelector("[data-teen-application-form]");
	const status = page.querySelector("[data-teen-application-status]");
	const account = await requirePermanentAccount("teen-member-apply.html");
	if (!account) return;
	if (account.context.profile.account_type !== "teen_member") {
		setStatus(status, "This application requires a Teen Member Account. Sign out and create a Teen Member Account to continue.", "error");
		form.hidden = true;
		return;
	}

	const { supabase } = await platformReady();
	const { data: existing, error: loadError } = await supabase
		.from("teen_member_applications")
		.select("id,status,submitted_at")
		.eq("user_id", account.session.user.id)
		.maybeSingle();
	if (loadError) throw loadError;
	if (existing) {
		form.hidden = true;
		setStatus(status, `Your application is ${existing.status}. You can follow its progress from the Teen Member dashboard.`, "info");
		return;
	}

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		setStatus(status);
		const values = new FormData(form);
		setFormBusy(form, true, "Submitting...");
		const { error } = await supabase.from("teen_member_applications").insert({
			user_id: account.session.user.id,
			age: Number(values.get("age")),
			guardian_name: String(values.get("guardian_name") || "").trim(),
			guardian_email: String(values.get("guardian_email") || "").trim(),
			guardian_phone: String(values.get("guardian_phone") || "").trim(),
			guardian_consent: values.has("guardian_consent"),
		});
		setFormBusy(form, false);
		if (error) {
			setStatus(status, friendlyError(error, "Your application could not be submitted."), "error");
			return;
		}
		form.hidden = true;
		setStatus(status, "Application submitted. An administrator will review it before roles are assigned.", "success");
	});
};

const renderTeenAssignments = async (supabase, assignments, container) => {
	container.replaceChildren();
	if (!assignments.length) {
		container.appendChild(createElement("p", "pca-empty-state", "No volunteer event assignments yet."));
		return;
	}
	const eventIds = [...new Set(assignments.map((assignment) => assignment.event_id))];
	const { data: events, error } = await supabase.from("events").select("id,title,starts_at,ends_at,location").in("id", eventIds);
	if (error) throw error;
	const eventById = new Map((events || []).map((event) => [event.id, event]));
	assignments.forEach((assignment) => {
		const event = eventById.get(assignment.event_id);
		const card = createElement("article", "pca-card pca-assignment-card");
		card.append(createElement("span", "pca-status-badge", assignment.status), createElement("h3", "", event?.title || "PCA event"));
		card.appendChild(createElement("p", "", assignment.role_title));
		if (event) card.appendChild(createElement("p", "", `${formatEventRange(event)} · ${event.location}`));
		if (assignment.instructions) card.appendChild(createElement("p", "", assignment.instructions));
		container.appendChild(card);
	});
};

const initializeTeenDashboard = async () => {
	const page = document.querySelector("[data-teen-dashboard]");
	if (!page) return;
	const status = page.querySelector("[data-teen-dashboard-status]");
	const account = await requirePermanentAccount("teen-member-dashboard.html");
	if (!account) return;
	if (account.context.profile.account_type !== "teen_member") {
		window.location.replace("dashboard.html");
		return;
	}
	const { supabase } = await platformReady();
	const [applicationResult, rolesResult, assignmentsResult] = await Promise.all([
		supabase.from("teen_member_applications").select("id,status,admin_notes,submitted_at,reviewed_at").eq("user_id", account.session.user.id).maybeSingle(),
		supabase.from("teen_member_role_assignments").select("role,assigned_at").eq("user_id", account.session.user.id).is("revoked_at", null),
		supabase.from("event_volunteer_assignments").select("id,event_id,role_title,instructions,status,created_at").eq("teen_member_user_id", account.session.user.id).order("created_at", { ascending: false }),
	]);
	for (const result of [applicationResult, rolesResult, assignmentsResult]) if (result.error) throw result.error;

	page.querySelector("[data-teen-name]").textContent = account.context.profile.full_name;
	const application = applicationResult.data;
	const applicationCard = page.querySelector("[data-teen-application-summary]");
	if (!application) {
		applicationCard.appendChild(createElement("p", "", "Your Teen Member application has not been submitted."));
		const action = createElement("a", "button primary", "Start Application");
		action.href = "teen-member-apply.html";
		applicationCard.appendChild(action);
	} else {
		applicationCard.append(createElement("span", `pca-status-badge is-${application.status}`, application.status), createElement("p", "", `Submitted ${formatShortDate(application.submitted_at)}.`));
		if (application.admin_notes) applicationCard.appendChild(createElement("p", "", application.admin_notes));
	}

	const roleList = page.querySelector("[data-teen-role-list]");
	const roles = rolesResult.data || [];
	if (!roles.length) roleList.appendChild(createElement("p", "pca-empty-state", "Roles appear here after your application is approved."));
	roles.forEach(({ role }) => roleList.appendChild(createElement("span", "pca-role-chip", roleLabels[role] || role)));

	const roleNames = new Set(roles.map(({ role }) => role));
	page.querySelector("[data-editor-tools]").hidden = !roleNames.has("editor");
	page.querySelector("[data-volunteer-tools]").hidden = !roleNames.has("volunteer");
	await renderTeenAssignments(supabase, assignmentsResult.data || [], page.querySelector("[data-teen-assignments]"));

	if (roleNames.has("volunteer")) {
		const profileForm = page.querySelector("[data-teen-volunteer-profile-form]");
		const profileStatus = page.querySelector("[data-teen-volunteer-profile-status]");
		const volunteerProfileResult = await supabase.from("teen_volunteer_profiles").select("*").eq("user_id", account.session.user.id).maybeSingle();
		if (volunteerProfileResult.error) throw volunteerProfileResult.error;
		let volunteerProfile = volunteerProfileResult.data;
		if (volunteerProfile) {
			["grade_level", "school_name", "phone", "interests", "experience", "availability"].forEach((name) => { profileForm.elements[name].value = volunteerProfile[name] || ""; });
		}
		profileForm.addEventListener("submit", async (event) => {
			event.preventDefault();
			const values = new FormData(profileForm);
			const payload = {
				user_id: account.session.user.id,
				grade_level: values.get("grade_level"),
				school_name: String(values.get("school_name") || "").trim(),
				phone: String(values.get("phone") || "").trim(),
				interests: String(values.get("interests") || "").trim(),
				experience: String(values.get("experience") || "").trim(),
				availability: String(values.get("availability") || "").trim(),
				setup_completed_at: new Date().toISOString(),
			};
			setFormBusy(profileForm, true, "Saving...");
			const result = volunteerProfile
				? await supabase.from("teen_volunteer_profiles").update(payload).eq("user_id", account.session.user.id)
				: await supabase.from("teen_volunteer_profiles").insert(payload);
			setFormBusy(profileForm, false);
			setStatus(profileStatus, result.error ? friendlyError(result.error, "Volunteer details could not be saved.") : "Volunteer details saved.", result.error ? "error" : "success");
			if (!result.error) volunteerProfile = payload;
		});

		const hoursForm = page.querySelector("[data-teen-hours-form]");
		const assignmentSelect = hoursForm.elements.assignment_id;
		(assignmentsResult.data || []).filter((assignment) => assignment.status !== "cancelled").forEach((assignment) => {
			const option = createElement("option", "", assignment.role_title);
			option.value = assignment.id;
			assignmentSelect.appendChild(option);
		});
		const hoursBody = page.querySelector("[data-teen-hours-body]");
		const loadHours = async () => {
			const { data: hours, error } = await supabase.from("volunteer_service_hours").select("*").eq("teen_member_user_id", account.session.user.id).order("service_date", { ascending: false });
			if (error) throw error;
			hoursBody.replaceChildren();
			(hours || []).forEach((entry) => {
				const row = createElement("tr");
				[formatShortDate(`${entry.service_date}T12:00:00`), entry.submitted_hours, entry.approved_hours ?? "—", entry.status, entry.description].forEach((value) => row.appendChild(createElement("td", "", String(value))));
				hoursBody.appendChild(row);
			});
		};
		hoursForm.addEventListener("submit", async (event) => {
			event.preventDefault();
			const values = new FormData(hoursForm);
			setFormBusy(hoursForm, true, "Submitting...");
			const { error } = await supabase.from("volunteer_service_hours").insert({
				assignment_id: values.get("assignment_id"),
				service_date: values.get("service_date"),
				submitted_hours: Number(values.get("submitted_hours")),
				description: String(values.get("description") || "").trim(),
			});
			setFormBusy(hoursForm, false);
			setStatus(page.querySelector("[data-teen-hours-status]"), error ? friendlyError(error, "Hours could not be submitted.") : "Service hours submitted for review.", error ? "error" : "success");
			if (!error) { hoursForm.reset(); await loadHours(); }
		});
		await loadHours();
	}
	setStatus(status);
};

const registrationGroupLabel = (registration, event) => {
	if (registration.status === "cancelled") return "Cancelled";
	if (registration.status === "waitlisted") return "Waitlisted";
	return new Date(event.starts_at) > new Date() ? "Upcoming" : "Past";
};

const renderHouseholdRegistration = (registration, event, attendees, supabase, reload) => {
	const card = createElement("article", "pca-card pca-registration-card");
	const label = registrationGroupLabel(registration, event);
	card.dataset.registrationGroup = label.toLowerCase();
	card.append(createElement("span", `pca-status-badge is-${registration.status}`, label), createElement("h3", "", event.title));
	card.appendChild(createElement("p", "", `${formatEventRange(event)} · ${event.location}`));
	const list = createElement("ul", "pca-compact-list");
	attendees.forEach((attendee) => list.appendChild(createElement("li", "", attendee.full_name)));
	card.appendChild(list);
	if (registration.status !== "cancelled" && new Date(event.starts_at) > new Date()) {
		const actions = createElement("ul", "actions");
		const edit = createElement("a", "button", "Change Registration");
		edit.href = `register.html?event=${encodeURIComponent(event.id)}&registration=${encodeURIComponent(registration.id)}`;
		const cancel = createElement("button", "button", "Cancel");
		cancel.type = "button";
		cancel.addEventListener("click", async () => {
			if (!window.confirm(`Cancel the registration for ${event.title}?`)) return;
			cancel.disabled = true;
			const { error } = await supabase.rpc("cancel_event_registration", { p_registration_id: registration.id });
			if (error) {
				cancel.disabled = false;
				window.alert(friendlyError(error, "The registration could not be cancelled."));
				return;
			}
			await reload();
		});
		actions.append(createElement("li", "").appendChild(edit).parentElement, createElement("li", "").appendChild(cancel).parentElement);
		card.appendChild(actions);
	}
	return card;
};

const initializeHouseholdDashboard = async () => {
	const page = document.querySelector("[data-household-dashboard]");
	if (!page) return;
	const account = await requirePermanentAccount("dashboard.html");
	if (!account) return;
	if (account.context.profile.account_type !== "household") {
		window.location.replace("teen-member-dashboard.html");
		return;
	}
	const { supabase } = await platformReady();
	const status = page.querySelector("[data-household-dashboard-status]");
	const container = page.querySelector("[data-household-registrations]");
	page.querySelector("[data-household-name]").textContent = account.context.profile.full_name;
	let activeRegistrationFilter = "all";

	const syncRegistrationFilter = () => {
		const cards = [...container.querySelectorAll("[data-registration-group]")];
		let visibleCount = 0;
		cards.forEach((card) => {
			const visible = activeRegistrationFilter === "all" || card.dataset.registrationGroup === activeRegistrationFilter;
			card.hidden = !visible;
			if (visible) visibleCount += 1;
		});

		let emptyState = container.querySelector("[data-registration-empty]");
		if (!emptyState) {
			emptyState = createElement("p", "pca-empty-state");
			emptyState.dataset.registrationEmpty = "true";
			container.appendChild(emptyState);
		}
		const emptyMessages = {
			all: "No event registrations yet.",
			upcoming: "No upcoming event registrations.",
			past: "No past event registrations.",
			waitlisted: "No waitlisted registrations.",
			cancelled: "No cancelled registrations.",
		};
		emptyState.textContent = emptyMessages[activeRegistrationFilter] || "No matching registrations.";
		emptyState.hidden = visibleCount > 0;
	};

	const loadRegistrations = async () => {
		setStatus(status, "Loading registration history...", "info");
		const { data: registrations, error } = await supabase.from("event_registrations").select("*").eq("owner_user_id", account.session.user.id).order("created_at", { ascending: false });
		if (error) throw error;
		container.replaceChildren();
		if (!registrations?.length) {
			syncRegistrationFilter();
			setStatus(status);
			return;
		}
		const eventIds = [...new Set(registrations.map((registration) => registration.event_id))];
		const registrationIds = registrations.map((registration) => registration.id);
		const [eventsResult, attendeesResult] = await Promise.all([
			supabase.from("events").select("id,title,location,starts_at,ends_at").in("id", eventIds),
			supabase.from("event_registration_attendees").select("*").in("registration_id", registrationIds).order("position"),
		]);
		if (eventsResult.error) throw eventsResult.error;
		if (attendeesResult.error) throw attendeesResult.error;
		const events = new Map((eventsResult.data || []).map((event) => [event.id, event]));
		registrations.forEach((registration) => {
			const event = events.get(registration.event_id);
			if (!event) return;
			const attendees = (attendeesResult.data || []).filter((attendee) => attendee.registration_id === registration.id);
			container.appendChild(renderHouseholdRegistration(registration, event, attendees, supabase, loadRegistrations));
		});
		syncRegistrationFilter();
		setStatus(status);
	};

	page.querySelectorAll("[data-registration-filter]").forEach((button) => button.addEventListener("click", () => {
		activeRegistrationFilter = button.dataset.registrationFilter;
		page.querySelectorAll("[data-registration-filter]").forEach((item) => {
			const selected = item === button;
			item.classList.toggle("primary", selected);
			item.classList.toggle("is-selected", selected);
			item.setAttribute("aria-pressed", String(selected));
		});
		syncRegistrationFilter();
	}));

	const memberList = page.querySelector("[data-household-member-list]");
	const memberForm = page.querySelector("[data-household-member-form]");
	const memberStatus = page.querySelector("[data-household-member-status]");
	const syncMemberType = () => {
		const child = memberForm.elements.attendee_type.value === "child";
		memberForm.querySelectorAll("[data-household-child-field]").forEach((field) => { field.hidden = !child; });
		memberForm.elements.age.required = child;
		memberForm.elements.school_district.required = child;
		if (!child) {
			memberForm.elements.age.value = "";
			memberForm.elements.school_district.value = "";
		}
	};
	memberForm.elements.attendee_type.addEventListener("change", syncMemberType);
	syncMemberType();

	const loadMembers = async () => {
		const { data: members, error } = await supabase.from("household_members").select("*").eq("account_id", account.session.user.id).order("created_at");
		if (error) throw error;
		memberList.replaceChildren();
		if (!members?.length) memberList.appendChild(createElement("p", "pca-empty-state", "No saved household members yet."));
		(members || []).forEach((member) => {
			const card = createElement("article", "pca-card pca-saved-member-card");
			card.append(createElement("h3", "", member.full_name), createElement("p", "", member.attendee_type === "child" ? `Age ${member.age} · ${member.school_district}` : "Adult"));
			const edit = createElement("button", "button small", "Edit");
			edit.type = "button";
			edit.addEventListener("click", () => {
				memberForm.elements.member_id.value = member.id;
				memberForm.elements.full_name.value = member.full_name;
				memberForm.elements.attendee_type.value = member.attendee_type;
				memberForm.elements.age.value = member.age ?? "";
				memberForm.elements.school_district.value = member.school_district || "";
				syncMemberType();
				memberForm.scrollIntoView({ behavior: "smooth", block: "center" });
			});
			const remove = createElement("button", "button small", "Remove");
			remove.type = "button";
			remove.addEventListener("click", async () => {
				if (!window.confirm(`Remove ${member.full_name} from saved household members?`)) return;
				const { error: removeError } = await supabase.from("household_members").delete().eq("id", member.id);
				if (removeError) window.alert(friendlyError(removeError));
				else await loadMembers();
			});
			const actions = createElement("div", "pca-saved-member-card-actions");
			actions.append(edit, remove);
			card.appendChild(actions);
			memberList.appendChild(card);
		});
	};

	memberForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		const values = new FormData(memberForm);
		const payload = {
			account_id: account.session.user.id,
			full_name: String(values.get("full_name") || "").trim(),
			attendee_type: String(values.get("attendee_type") || ""),
			age: values.get("attendee_type") === "child" ? Number(values.get("age")) : null,
			school_district: values.get("attendee_type") === "child" ? String(values.get("school_district") || "").trim() : null,
			grade: null,
		};
		setFormBusy(memberForm, true, "Saving...");
		const result = values.get("member_id")
			? await supabase.from("household_members").update(payload).eq("id", values.get("member_id"))
			: await supabase.from("household_members").insert(payload);
		setFormBusy(memberForm, false);
		if (result.error) {
			setStatus(memberStatus, friendlyError(result.error, "The household member could not be saved."), "error");
			return;
		}
		memberForm.reset();
		memberForm.elements.member_id.value = "";
		syncMemberType();
		setStatus(memberStatus, "Household member saved.", "success");
		await loadMembers();
	});
	page.querySelector("[data-household-member-clear]").addEventListener("click", () => { memberForm.reset(); memberForm.elements.member_id.value = ""; syncMemberType(); });

	await Promise.all([loadRegistrations(), loadMembers()]);
};

const initializeProfileContact = async () => {
	const form = document.querySelector("[data-profile-contact-form]");
	if (!form) return;
	const session = await getSession();
	if (!session) return;
	const context = await getAccountContext();
	if (!context.profile) return;
	const { supabase } = await platformReady();
	const status = form.querySelector("[data-profile-contact-status]");
	form.elements.contact_email.value = context.profile.contact_email || context.profile.email || "";
	form.elements.contact_phone.value = context.profile.contact_phone || "";
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		setFormBusy(form, true, "Saving...");
		const values = new FormData(form);
		const { error } = await supabase.rpc("save_account_profile", {
			p_user_id: session.user.id,
			p_full_name: context.profile.full_name,
			p_contact_email: String(values.get("contact_email") || "").trim(),
			p_contact_phone: String(values.get("contact_phone") || "").trim(),
		});
		setFormBusy(form, false);
		setStatus(status, error ? friendlyError(error, "Contact details could not be saved.") : "Registration contact saved.", error ? "error" : "success");
	});
};

export const initializeAccountPages = async () => {
	await Promise.all([
		initializeTeenApplication(),
		initializeTeenDashboard(),
		initializeHouseholdDashboard(),
		initializeProfileContact(),
	]);
};
