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
} from "./core-auth.js?v=20260830-past-events-v1";

const roleLabels = {
	student_council: "Student Council",
	editor: "Blog Editor",
	volunteer: "Volunteer",
};

export const filterRecordsWithVisibleEvents = (records, eventById) => records.filter((record) => {
	const event = eventById.get(record.event_id);
	return event && !event.deleted_at;
});

const requestVolunteerSubmissionEmails = async (supabase, applicationId) => {
	if (!applicationId) return;
	const { error } = await supabase.functions.invoke("pca-transactional-email", {
		body: { kind: "volunteer_account_submitted", resource_id: applicationId },
	});
	if (error) console.debug("Volunteer application email delivery remains queued.", error);
};

const initializeTeenApplication = async () => {
	const page = document.querySelector("[data-teen-application-page]");
	if (!page) return;
	const form = page.querySelector("[data-teen-application-form]");
	const status = page.querySelector("[data-teen-application-status]");
	const account = await requirePermanentAccount("volunteer-account-apply.html");
	if (!account) return;
	if (account.context.profile.account_type !== "teen_member") {
		setStatus(status, "This application requires a Volunteer Account. Sign out and create a Volunteer Account to continue.", "error");
		form.hidden = true;
		return;
	}

	const { supabase } = await platformReady();
	const { data: existing, error: loadError } = await supabase
		.from("volunteer_applications")
		.select("id,status,submitted_at")
		.eq("user_id", account.session.user.id)
		.maybeSingle();
	if (loadError) throw loadError;
	if (existing) {
		form.hidden = true;
		setStatus(status, `Your application is ${existing.status}. You can follow its progress from the Volunteer dashboard.`, "info");
		return;
	}

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		setStatus(status);
		const values = new FormData(form);
		setFormBusy(form, true, "Submitting...");
		const { data: applicationId, error } = await supabase.rpc("submit_volunteer_account_application", {
			p_age: Number(values.get("age")),
			p_phone: String(values.get("phone") || "").trim(),
			p_school_name: String(values.get("school_name") || "").trim(),
		});
		setFormBusy(form, false);
		if (error) {
			setStatus(status, friendlyError(error, "Your application could not be submitted."), "error");
			return;
		}
		void requestVolunteerSubmissionEmails(supabase, applicationId);
		form.hidden = true;
		setStatus(status, "Application received. PCA and your email address have been notified. An administrator must approve the account before assignments and hour tracking are available.", "success");
	});
};

const renderTeenAssignments = async (supabase, assignments, container) => {
	container.replaceChildren();
	if (!assignments.length) {
		container.appendChild(createElement("p", "pca-empty-state", "No volunteer event assignments yet."));
		return [];
	}
	const eventIds = [...new Set(assignments.map((assignment) => assignment.event_id))];
	const { data: events, error } = await supabase.from("events").select("id,title,starts_at,ends_at,event_date,location,deleted_at").in("id", eventIds).is("deleted_at", null);
	if (error) throw error;
	const eventById = new Map((events || []).map((event) => [event.id, event]));
	const activeAssignments = filterRecordsWithVisibleEvents(assignments, eventById);
	if (!activeAssignments.length) {
		container.appendChild(createElement("p", "pca-empty-state", "No volunteer event assignments yet."));
		return [];
	}
	activeAssignments.forEach((assignment) => {
		const event = eventById.get(assignment.event_id);
		const card = createElement("article", "pca-card pca-assignment-card");
		card.append(createElement("span", "pca-status-badge", assignment.status), createElement("h3", "", event.title));
		card.appendChild(createElement("p", "", assignment.role_title));
		card.appendChild(createElement("p", "", `${formatEventRange(event)} · ${event.location}`));
		if (assignment.instructions) card.appendChild(createElement("p", "", assignment.instructions));
		container.appendChild(card);
	});
	return activeAssignments;
};

const initializeTeenDashboard = async () => {
	const page = document.querySelector("[data-teen-dashboard]");
	if (!page) return;
	const status = page.querySelector("[data-teen-dashboard-status]");
	const account = await requirePermanentAccount("volunteer-dashboard.html");
	if (!account) return;
	if (account.context.profile.account_type !== "teen_member") {
		window.location.replace("dashboard.html");
		return;
	}
	const { supabase } = await platformReady();
	const [applicationResult, rolesResult, assignmentsResult] = await Promise.all([
		supabase.from("volunteer_applications").select("id,status,admin_notes,submitted_at,reviewed_at,age,phone,school_name").eq("user_id", account.session.user.id).maybeSingle(),
		supabase.from("teen_member_role_assignments").select("role,assigned_at").eq("user_id", account.session.user.id).is("revoked_at", null),
		supabase.from("event_volunteer_assignments").select("id,event_id,role_title,instructions,status,created_at").eq("teen_member_user_id", account.session.user.id).order("created_at", { ascending: false }),
	]);
	for (const result of [applicationResult, rolesResult, assignmentsResult]) if (result.error) throw result.error;

	page.querySelector("[data-teen-name]").textContent = account.context.profile.full_name;
	const application = applicationResult.data;
	const applicationCard = page.querySelector("[data-teen-application-summary]");
	if (!application) {
		applicationCard.appendChild(createElement("p", "", "Your Volunteer Account application has not been submitted."));
		const action = createElement("a", "button primary", "Start Application");
		action.href = "volunteer-account-apply.html";
		applicationCard.appendChild(action);
	} else {
		applicationCard.append(createElement("span", `pca-status-badge is-${application.status}`, application.status), createElement("p", "", `Submitted ${formatShortDate(application.submitted_at)}.`));
		if (application.status === "pending") applicationCard.appendChild(createElement("p", "", "PCA is reviewing your account. Assignments and service-hour tracking will unlock after approval."));
		applicationCard.appendChild(createElement("p", "pca-account-detail-line", `${application.school_name} · ${application.phone} · Age ${application.age}`));
		if (application.admin_notes) applicationCard.appendChild(createElement("p", "", application.admin_notes));
	}

	const roleList = page.querySelector("[data-teen-role-list]");
	const roles = rolesResult.data || [];
	if (!roles.length) roleList.appendChild(createElement("p", "pca-empty-state", "Roles appear here after your application is approved."));
	roles.forEach(({ role }) => roleList.appendChild(createElement("span", "pca-role-chip", roleLabels[role] || role)));

	const roleNames = new Set(roles.map(({ role }) => role));
	page.querySelector("[data-editor-tools]").hidden = !roleNames.has("editor");
	page.querySelector("[data-volunteer-tools]").hidden = !roleNames.has("volunteer");
	const visibleAssignments = await renderTeenAssignments(supabase, assignmentsResult.data || [], page.querySelector("[data-teen-assignments]"));

	if (roleNames.has("volunteer")) {
		const profileForm = page.querySelector("[data-teen-volunteer-profile-form]");
		const profileStatus = page.querySelector("[data-teen-volunteer-profile-status]");
		const volunteerProfileResult = await supabase.from("teen_volunteer_profiles").select("*").eq("user_id", account.session.user.id).maybeSingle();
		if (volunteerProfileResult.error) throw volunteerProfileResult.error;
		let volunteerProfile = volunteerProfileResult.data;
		if (volunteerProfile) {
			["grade_level", "school_name", "phone", "interests", "experience", "availability"].forEach((name) => { profileForm.elements[name].value = volunteerProfile[name] || ""; });
		}
		if (!profileForm.elements.school_name.value) profileForm.elements.school_name.value = application?.school_name || "";
		if (!profileForm.elements.phone.value) profileForm.elements.phone.value = application?.phone || "";
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
		const activeAssignments = visibleAssignments.filter((assignment) => assignment.status !== "cancelled");
		const assignmentById = new Map(activeAssignments.map((assignment) => [assignment.id, assignment]));
		activeAssignments.forEach((assignment) => {
			const option = createElement("option", "", assignment.role_title);
			option.value = assignment.id;
			assignmentSelect.appendChild(option);
		});
		if (activeAssignments.length === 1) assignmentSelect.value = activeAssignments[0].id;
		const hoursBody = page.querySelector("[data-teen-hours-body]");
		const hoursTable = hoursBody.closest(".table-wrapper");
		const summary = createElement("div", "pca-volunteer-hours-summary");
		const summaryValues = {};
		[["submitted", "Submitted"], ["pending", "Awaiting review"], ["approved", "Approved"]].forEach(([key, label]) => {
			const item = createElement("div");
			const value = createElement("strong", "", "0");
			value.dataset.hoursSummary = key;
			summaryValues[key] = value;
			item.append(value, createElement("span", "", label));
			summary.appendChild(item);
		});
		hoursTable?.before(summary);
		const loadHours = async () => {
			const { data: hours, error } = await supabase.from("volunteer_service_hours").select("*").eq("teen_member_user_id", account.session.user.id).order("service_date", { ascending: false });
			if (error) throw error;
			const submittedTotal = (hours || []).reduce((total, entry) => total + Number(entry.submitted_hours || 0), 0);
			const pendingTotal = (hours || []).filter((entry) => entry.status === "submitted").reduce((total, entry) => total + Number(entry.submitted_hours || 0), 0);
			const approvedTotal = (hours || []).filter((entry) => entry.status === "approved").reduce((total, entry) => total + Number(entry.approved_hours || 0), 0);
			summaryValues.submitted.textContent = submittedTotal.toFixed(2).replace(/\.00$/, "");
			summaryValues.pending.textContent = pendingTotal.toFixed(2).replace(/\.00$/, "");
			summaryValues.approved.textContent = approvedTotal.toFixed(2).replace(/\.00$/, "");
			hoursBody.replaceChildren();
			(hours || []).forEach((entry) => {
				const row = createElement("tr");
				const assignment = assignmentById.get(entry.assignment_id);
				const values = [
					["Date", formatShortDate(`${entry.service_date}T12:00:00`)],
					["Submitted", entry.submitted_hours],
					["Approved", entry.approved_hours ?? "—"],
					["Status", entry.status],
					["Description", assignment ? `${assignment.role_title}: ${entry.description}` : entry.description],
				];
				values.forEach(([label, value]) => {
					const cell = createElement("td", "", String(value));
					cell.dataset.label = label;
					row.appendChild(cell);
				});
				hoursBody.appendChild(row);
			});
			if (!hours?.length) {
				const row = createElement("tr");
				const cell = createElement("td", "pca-admin-empty", "No service hours have been submitted yet.");
				cell.colSpan = 5;
				row.appendChild(cell);
				hoursBody.appendChild(row);
			}
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
			if (!error) {
				hoursForm.reset();
				if (activeAssignments.length === 1) assignmentSelect.value = activeAssignments[0].id;
				await loadHours();
			}
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
	const heading = createElement("div", "pca-registration-card__heading");
	heading.append(createElement("h3", "", event.title), createElement("span", `pca-status-badge is-${registration.status}`, label));
	card.appendChild(heading);
	const meta = createElement("p", "pca-registration-card__meta");
	meta.append(createElement("span", "", formatEventRange(event)), createElement("span", "", event.location));
	card.appendChild(meta);
	card.appendChild(createElement("h4", "", `Registered Attendees (${attendees.length})`));
	const list = createElement("ul", "pca-compact-list");
	attendees.forEach((attendee) => list.appendChild(createElement("li", "", attendee.full_name)));
	card.appendChild(list);
	if (registration.status === "confirmed" && new Date(event.ends_at) > new Date()) {
		const checkin = createElement("details", "pca-checkin-card");
		const summary = createElement("summary", "", "Event check-in code");
		const copy = createElement("p", "pca-form-help", "Create a secure code when PCA staff asks for it at check-in. Creating a new code replaces the previous one.");
		const code = createElement("output", "pca-checkin-code");
		code.hidden = true;
		const copyCode = createElement("button", "button small", "Copy Code");
		copyCode.type = "button";
		copyCode.hidden = true;
		copyCode.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(code.textContent);
				status.textContent = "Check-in code copied.";
				status.className = "pca-backend-status is-success";
			} catch {
				status.textContent = "Copy was blocked by your browser. Select the code and copy it manually.";
				status.className = "pca-backend-status is-info";
			}
		});
		const status = createElement("p", "pca-backend-status");
		status.setAttribute("role", "status");
		status.setAttribute("aria-live", "polite");
		const issue = createElement("button", "button small", "Create Check-in Code");
		issue.type = "button";
		issue.addEventListener("click", async () => {
			if (!window.confirm("Create a new check-in code? Any previously created code for this registration will stop working.")) return;
			issue.disabled = true;
			status.textContent = "Creating a secure code...";
			status.className = "pca-backend-status is-info";
			const { data: token, error } = await supabase.rpc("issue_registration_checkin_token", { p_registration_id: registration.id });
			issue.disabled = false;
			if (error || !token) {
				status.textContent = friendlyError(error, "The check-in code could not be created.");
				status.className = "pca-backend-status is-error";
				return;
			}
			code.textContent = String(token).toUpperCase();
			code.hidden = false;
			copyCode.hidden = false;
			issue.textContent = "Replace Check-in Code";
			status.textContent = "Show this code to PCA staff. For your privacy, it will disappear when you leave this page.";
			status.className = "pca-backend-status is-success";
		});
		checkin.append(summary, copy, issue, code, copyCode, status);
		card.appendChild(checkin);
	}
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
			void supabase.functions.invoke("pca-transactional-email", {
				body: { retry_promotions: true, source_registration_id: registration.id, event_id: event.id },
			})
				.then(({ error: promotionError }) => {
					if (promotionError) console.debug("A waitlist notification remains safely queued.", promotionError);
				});
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
		window.location.replace("volunteer-dashboard.html");
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
			supabase.from("events").select("id,title,location,starts_at,ends_at,event_date,deleted_at").in("id", eventIds).is("deleted_at", null),
			supabase.from("event_registration_attendees").select("*").in("registration_id", registrationIds).order("position"),
		]);
		if (eventsResult.error) throw eventsResult.error;
		if (attendeesResult.error) throw attendeesResult.error;
		const events = new Map((eventsResult.data || []).map((event) => [event.id, event]));
		const visibleRegistrations = filterRecordsWithVisibleEvents(registrations, events);
		visibleRegistrations.forEach((registration) => {
			const event = events.get(registration.event_id);
			const attendees = (attendeesResult.data || []).filter((attendee) => attendee.registration_id === registration.id);
			container.appendChild(renderHouseholdRegistration(registration, event, attendees, supabase, loadRegistrations));
		});
		const counts = { all: visibleRegistrations.length, upcoming: 0, past: 0, waitlisted: 0, cancelled: 0 };
		container.querySelectorAll("[data-registration-group]").forEach((card) => {
			if (Object.hasOwn(counts, card.dataset.registrationGroup)) counts[card.dataset.registrationGroup] += 1;
		});
		Object.entries(counts).forEach(([group, count]) => {
			const countElement = page.querySelector(`[data-registration-filter-count="${group}"]`);
			if (countElement) countElement.textContent = String(count);
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
	const memberEditor = page.querySelector("[data-household-member-editor]");
	const memberStatus = page.querySelector("[data-household-member-status]");
	const openMemberEditor = () => {
		memberEditor.open = true;
		memberEditor.scrollIntoView({ behavior: "smooth", block: "center" });
		window.setTimeout(() => memberForm.elements.full_name.focus(), 250);
	};
	page.querySelector("[data-household-add-member]")?.addEventListener("click", openMemberEditor);
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
				openMemberEditor();
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

export const initializeAccountPages = async () => {
	await Promise.all([
		initializeTeenApplication(),
		initializeTeenDashboard(),
		initializeHouseholdDashboard(),
	]);
};
