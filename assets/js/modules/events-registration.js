import {
	createElement,
	currentEventId,
	formatEventRange,
	formatShortDate,
	friendlyError,
	getAccountContext,
	getSession,
	normalizeAttendee,
	platformReady,
	setFormBusy,
	setStatus,
} from "./core-auth.js?v=20260913-admin-otp-v1";

const registrationStatusLabels = Object.freeze({
	confirmed: "Confirmed",
	waitlisted: "On the waitlist",
	cancelled: "Cancelled",
});

export const registrationOutcomeCopy = (status, count) => {
	const group = count === 1 ? "Your attendee" : `Your group of ${count}`;
	if (status === "waitlisted") return `${group} is on the waitlist. PCA will email you if space opens up.`;
	if (status === "confirmed") return `${group} is confirmed.`;
	return `${group} has been recorded.`;
};

export const attendeeSummaryLine = (attendee) => {
	const name = String(attendee?.full_name || "").trim() || "Attendee";
	if (attendee?.attendee_type === "child") {
		const details = [attendee.age != null && attendee.age !== "" ? `age ${attendee.age}` : "", attendee.school_district || ""].filter(Boolean);
		return details.length ? `${name} (${details.join(", ")})` : name;
	}
	if (attendee?.attendee_type === "adult") return `${name} (adult)`;
	return name;
};

const isViewToken = (value) => /^[0-9a-f]{64}$/i.test(String(value || ""));

const registrationViewUrl = (token) => `registration.html?token=${encodeURIComponent(String(token || "").toLowerCase())}`;

const issueViewLink = async (supabase, registrationId) => {
	if (!registrationId) return "";
	const { data, error } = await supabase.rpc("issue_registration_view_token", { p_registration_id: registrationId });
	if (error || !isViewToken(data)) {
		if (error) console.debug("A registration view link could not be created.", error);
		return "";
	}
	return registrationViewUrl(data);
};

const referralLabels = {
	friend_recommendation: "Friend recommendation",
	wechat_post: "WeChat post",
	facebook_post: "Facebook post",
	instagram: "Instagram",
	flyer: "Flyer",
	poster: "Poster",
	website: "Website",
	email: "Email",
	other: "Other",
};

const turnstileScriptId = "pca-turnstile-script";
const turnstileOnloadCallback = "pcaTurnstileOnload";
let turnstileReadinessPromise = null;

const passwordValidationMessage = (password) => (
	password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)
		? "Your password needs at least 8 characters, with one uppercase letter, one lowercase letter, and one number."
		: ""
);

export const registrationReferralDetails = (source, details) => (
	source === "other" ? String(details || "").trim() || null : null
);

export const registrationEditAvailability = ({
	registration,
	eventId,
	eventStartsAt,
	isAdmin = false,
}) => {
	if (!registration) return "missing";
	if (registration.event_id !== eventId) return "event_mismatch";
	if (registration.status === "cancelled") return "cancelled";
	if (!isAdmin && new Date(eventStartsAt) <= new Date()) return "started";
	return "editable";
};

export const canAddRegistrationAttendee = ({ count, maximum, existingMemberIds = [], householdMemberId = null }) => {
	if (count >= maximum) return { allowed: false, reason: "maximum" };
	if (householdMemberId && existingMemberIds.includes(householdMemberId)) {
		return { allowed: false, reason: "duplicate" };
	}
	return { allowed: true, reason: null };
};

const loadTurnstile = () => {
	if (turnstileReadinessPromise) return turnstileReadinessPromise;

	turnstileReadinessPromise = new Promise((resolve, reject) => {
		if (window.turnstile) {
			resolve(window.turnstile);
			return;
		}

		const rejectLoad = () => reject(new Error("The guest security check could not be loaded. Please try again."));
		window[turnstileOnloadCallback] = () => {
			if (!window.turnstile) {
				rejectLoad();
				return;
			}
			resolve(window.turnstile);
		};

		let script = document.getElementById(turnstileScriptId);
		if (!script) {
			script = document.createElement("script");
			script.id = turnstileScriptId;
			script.src = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=${turnstileOnloadCallback}`;
			script.async = true;
			script.defer = true;
			script.onerror = rejectLoad;
			document.head.appendChild(script);
		}
	}).then((turnstile) => {
		delete window[turnstileOnloadCallback];
		return turnstile;
	}).catch((error) => {
		document.getElementById(turnstileScriptId)?.remove();
		delete window[turnstileOnloadCallback];
		turnstileReadinessPromise = null;
		throw error;
	});

	return turnstileReadinessPromise;
};

const createTurnstileChallenge = async (container) => {
	const siteKey = document.querySelector('meta[name="pca-turnstile-site-key"]')?.content.trim();
	if (!siteKey) {
		throw new Error("Guest registration is temporarily unavailable because its security check is not configured.");
	}
	const turnstile = await loadTurnstile();
	let widgetId;
	let settled = false;
	let fallbackTimeout;
	let execution;
	let terminalResult;
	const cleanup = () => {
		window.clearTimeout(fallbackTimeout);
		if (widgetId !== undefined) {
			try { turnstile.reset(widgetId); } catch (error) { console.debug("Turnstile reset skipped.", error); }
			try { turnstile.remove(widgetId); } catch (error) { console.debug("Turnstile removal skipped.", error); }
		}
		container.replaceWith(container.cloneNode(false));
	};
	const finish = (result) => {
		if (settled) return;
		settled = true;
		Promise.resolve().then(() => {
			cleanup();
			terminalResult = result;
			if (!execution) return;
			if (result.error) execution.reject(result.error);
			else execution.resolve(result.token);
		});
	};
	const fail = (message) => finish({ error: new Error(message) });

	widgetId = turnstile.render(container, {
		sitekey: siteKey,
		size: "invisible",
		execution: "execute",
		callback: (token) => finish({ token }),
		"error-callback": () => fail("The guest security check failed. Please try again."),
		"expired-callback": () => fail("The guest security check expired. Please try again."),
		"timeout-callback": () => fail("The guest security check timed out. Please try again."),
	});

	return {
		execute: () => {
			if (terminalResult?.error) return Promise.reject(terminalResult.error);
			if (terminalResult?.token) return Promise.resolve(terminalResult.token);
			return new Promise((resolve, reject) => {
				execution = { resolve, reject };
				fallbackTimeout = window.setTimeout(
					() => fail("The guest security check timed out. Please try again."),
					30000
				);
				turnstile.execute(widgetId);
			});
		},
	};
};

const requestTransactionalEmail = async (supabase, kind, resourceId) => {
	if (!resourceId) return null;
	const { data, error } = await supabase.functions.invoke("pca-transactional-email", {
		body: { kind, resource_id: resourceId },
	});
	if (error) console.warn(`The ${kind} email could not be dispatched immediately.`, error);
	return error ? null : data;
};

const createAttendeeRow = (index, attendee = {}) => {
	const fieldset = createElement("fieldset", "pca-participant-row");
	fieldset.dataset.attendeeRow = "true";
	if (attendee.household_member_id) fieldset.dataset.householdMemberId = attendee.household_member_id;
	fieldset.appendChild(createElement("legend", "", `Attendee ${index + 1}`));
	const fields = createElement("div", "fields pca-participant-fields");
	const idBase = `platform-attendee-${Date.now()}-${index}`;

	const nameField = createElement("div", "field pca-attendee-name-field");
	const nameLabel = createElement("label", "", "Full Name");
	nameLabel.htmlFor = `${idBase}-name`;
	const name = createElement("input");
	name.id = nameLabel.htmlFor;
	name.name = "attendee_name";
	name.type = "text";
	name.maxLength = 120;
	name.required = true;
	name.value = attendee.full_name || "";
	nameField.append(nameLabel, name);

	const typeField = createElement("div", "field");
	const typeLabel = createElement("label", "", "Attendee Type");
	typeLabel.htmlFor = `${idBase}-type`;
	const type = createElement("select");
	type.id = typeLabel.htmlFor;
	type.name = "attendee_type";
	type.required = true;
	[["", "Select type"], ["child", "Child / Youth"], ["adult", "Adult"]].forEach(([value, label]) => {
		const option = createElement("option", "", label);
		option.value = value;
		option.selected = (attendee.attendee_type || "") === value;
		type.appendChild(option);
	});
	typeField.append(typeLabel, type);

	const ageField = createElement("div", "field");
	ageField.dataset.childField = "true";
	const ageLabel = createElement("label", "", "Age");
	ageLabel.htmlFor = `${idBase}-age`;
	const age = createElement("input");
	age.id = ageLabel.htmlFor;
	age.name = "attendee_age";
	age.type = "number";
	age.min = "0";
	age.max = "25";
	age.value = attendee.age ?? "";
	ageField.append(ageLabel, age);

	const schoolField = createElement("div", "field");
	schoolField.dataset.childField = "true";
	const schoolLabel = createElement("label", "", "School / District");
	schoolLabel.htmlFor = `${idBase}-school`;
	const school = createElement("input");
	school.id = schoolLabel.htmlFor;
	school.name = "attendee_school";
	school.type = "text";
	school.maxLength = 160;
	school.value = attendee.school_district || "";
	schoolField.append(schoolLabel, school);

	const removeField = createElement("div", "field pca-participant-remove");
	const remove = createElement("button", "button small", "Remove");
	remove.type = "button";
	remove.addEventListener("click", () => {
		fieldset.dispatchEvent(new CustomEvent("pca:attendee-removed", {
			bubbles: true,
			detail: { householdMemberId: fieldset.dataset.householdMemberId || null },
		}));
		fieldset.remove();
	});
	removeField.appendChild(remove);
	fields.append(nameField, typeField, ageField, schoolField, removeField);
	fieldset.appendChild(fields);

	const syncType = () => {
		const child = type.value === "child";
		[ageField, schoolField].forEach((field) => { field.hidden = !child; });
		age.required = child;
		school.required = child;
		if (!child) {
			age.value = "";
			school.value = "";
		}
	};
	type.addEventListener("change", syncType);
	syncType();
	return fieldset;
};

const initializeRegistrationPage = async () => {
	const page = document.querySelector("[data-platform-registration]");
	if (!page) return;
	const eventId = currentEventId();
	const registrationId = new URLSearchParams(window.location.search).get("registration");
	const status = page.querySelector("[data-platform-registration-status]");
	const recovery = page.querySelector("[data-registration-recovery]");
	const content = page.querySelector("[data-platform-registration-content]");
	const chooser = page.querySelector("[data-registration-paths]");
	const form = page.querySelector("[data-platform-registration-form]");
	const attendeeList = page.querySelector("[data-platform-attendees]");
	const savedMembers = page.querySelector("[data-saved-member-picker]");
	const success = page.querySelector("[data-registration-success]");
	const stages = [...page.querySelectorAll("[data-registration-stage]")];
	const stepItems = [...page.querySelectorAll("[data-registration-step]")];
	const { supabase } = await platformReady();

	const showRegistrationStage = (name) => {
		stages.forEach((stage) => { stage.hidden = stage.dataset.registrationStage !== name; });
		const order = ["path", "attendees", "contact"];
		const activeIndex = order.indexOf(name);
		stepItems.forEach((step) => {
			const index = order.indexOf(step.dataset.registrationStep);
			step.toggleAttribute("aria-current", index === activeIndex);
			if (index === activeIndex) step.setAttribute("aria-current", "step");
			step.classList.toggle("is-complete", index < activeIndex);
		});
	};

	if (!eventId) {
		setStatus(status, "Choose an event before opening registration.", "error");
		if (recovery) recovery.hidden = false;
		return;
	}

	const { data: event, error: eventError } = await supabase.from("events").select("*").eq("id", eventId).single();
	const unavailableForNewRegistration = !registrationId && (
		!event?.published
		|| event?.deleted_at
		|| !event?.registration_open
		|| new Date(event?.starts_at) <= new Date()
	);
	if (eventError || !event || unavailableForNewRegistration) {
		setStatus(status, "This event is not available.", "error");
		if (recovery) recovery.hidden = false;
		return;
	}
	page.querySelector("[data-registration-event-title]").textContent = event.title;
	page.querySelector("[data-registration-event-date]").textContent = formatEventRange(event);
	page.querySelector("[data-registration-event-location]").textContent = event.location;
	page.querySelector("[data-registration-event-limit]").textContent = String(event.max_participants_per_registration);
	content.hidden = false;
	setStatus(status);

	let session = await getSession();
	let context = session ? await getAccountContext() : {};
	let guestMode = Boolean(session && context.is_anonymous);
	const claimKey = `pcaGuestClaim:${eventId}`;
	const existingPanel = page.querySelector("[data-registration-existing]");

	// A returning household or guest session that already holds a place is
	// told so up front instead of after filling in the whole form.
	const showExistingRegistration = async (existing) => {
		if (!existingPanel) return false;
		chooser.hidden = true;
		form.hidden = true;
		const names = Array.isArray(existing.attendee_names) ? existing.attendee_names.filter(Boolean) : [];
		const label = registrationStatusLabels[existing.status] || existing.status;
		const when = existing.created_at ? ` on ${formatShortDate(existing.created_at)}` : "";
		const who = names.length ? ` for ${names.join(", ")}` : "";
		existingPanel.querySelector("[data-registration-existing-summary]").textContent =
			`This ${context.profile ? "household account" : "guest session"} registered${who}${when}. Status: ${label}.`;
		const dashboardLink = existingPanel.querySelector("[data-registration-existing-dashboard]");
		if (dashboardLink) dashboardLink.hidden = context.profile?.account_type !== "household";
		const viewLink = existingPanel.querySelector("[data-registration-existing-view]");
		if (viewLink) {
			const href = await issueViewLink(supabase, existing.registration_id);
			viewLink.hidden = !href;
			if (href) viewLink.href = href;
		}
		existingPanel.hidden = false;
		stepItems.forEach((step) => {
			step.removeAttribute("aria-current");
			step.classList.add("is-complete");
		});
		setStatus(status);
		return true;
	};
	const syncAttendeeRows = () => {
		[...attendeeList.querySelectorAll("[data-attendee-row]")].forEach((row, index) => {
			const legend = row.querySelector("legend");
			if (legend) legend.textContent = `Attendee ${index + 1}`;
		});
		savedMembers.querySelectorAll("[data-household-member-button]").forEach((button) => {
			button.disabled = Boolean(attendeeList.querySelector(`[data-household-member-id="${CSS.escape(button.dataset.householdMemberButton)}"]`));
		});
	};
	const addAttendee = (attendee = {}) => {
		const decision = canAddRegistrationAttendee({
			count: attendeeList.children.length,
			maximum: event.max_participants_per_registration,
			existingMemberIds: [...attendeeList.querySelectorAll("[data-household-member-id]")].map((row) => row.dataset.householdMemberId),
			householdMemberId: attendee.household_member_id || null,
		});
		if (decision.reason === "maximum") {
			setStatus(status, `This event allows up to ${event.max_participants_per_registration} attendees per registration.`, "error");
			return false;
		}
		if (decision.reason === "duplicate") {
			setStatus(status, `${attendee.full_name || "That saved person"} is already included.`, "error");
			return false;
		}
		attendeeList.appendChild(createAttendeeRow(attendeeList.children.length, attendee));
		syncAttendeeRows();
		setStatus(status);
		return true;
	};
	attendeeList.addEventListener("pca:attendee-removed", () => queueMicrotask(syncAttendeeRows));
	let editRegistration = null;
	let editAttendees = [];

	if (registrationId) {
		if (!context.admin_level && context.profile?.account_type !== "household") {
			content.hidden = true;
			setStatus(status, "Sign in to the household account that owns this registration before editing it.", "error");
			if (recovery) recovery.hidden = false;
			return;
		}

		let registrationQuery = supabase.from("event_registrations").select("*").eq("id", registrationId);
		if (!context.admin_level) registrationQuery = registrationQuery.eq("owner_user_id", session.user.id);
		const [registrationResult, attendeesResult] = await Promise.all([
			registrationQuery.maybeSingle(),
			supabase.from("event_registration_attendees").select("*").eq("registration_id", registrationId).order("position"),
		]);
		if (registrationResult.error || attendeesResult.error || !registrationResult.data) {
			content.hidden = true;
			setStatus(status, "This registration could not be found or you do not have permission to edit it. Open the registration from your dashboard and try again.", "error");
			if (recovery) recovery.hidden = false;
			return;
		}

		editRegistration = registrationResult.data;
		editAttendees = attendeesResult.data || [];
		const editAvailability = registrationEditAvailability({
			registration: editRegistration,
			eventId,
			eventStartsAt: event.starts_at,
			isAdmin: Boolean(context.admin_level),
		});
		if (editAvailability === "event_mismatch") {
			content.hidden = true;
			setStatus(status, "This registration link does not match the selected event. Open the registration from your dashboard and try again.", "error");
			if (recovery) recovery.hidden = false;
			return;
		}
		if (editAvailability === "cancelled") {
			content.hidden = true;
			setStatus(status, "This registration was cancelled and can no longer be edited.", "error");
			if (recovery) recovery.hidden = false;
			return;
		}
		if (editAvailability === "started") {
			content.hidden = true;
			setStatus(status, "This event has already started, so household changes are closed. Contact PCA if you need help.", "error");
			if (recovery) recovery.hidden = false;
			return;
		}
	}

	const claimStoredRegistration = async () => {
		const token = sessionStorage.getItem(claimKey);
		if (!token || !context.profile) return false;
		const { error } = await supabase.rpc("claim_guest_registration", { p_claim_token: token });
		if (error) {
			setStatus(status, friendlyError(error, "The guest registration could not be attached."), "error");
			return false;
		}
		sessionStorage.removeItem(claimKey);
		setStatus(status, "Your guest registration is now attached to this household account.", "success");
		return true;
	};

	if (new URLSearchParams(window.location.search).get("claim") === "1") await claimStoredRegistration();

	if (!registrationId && session?.user && !context.admin_level) {
		const { data: existing, error: existingError } = await supabase.rpc("get_my_event_registration", { p_event_id: eventId });
		if (existingError) console.debug("Existing registration check skipped.", existingError);
		else if (existing && await showExistingRegistration(existing)) return;
	}

	const showForm = async () => {
		chooser.hidden = true;
		form.hidden = false;
		showRegistrationStage("attendees");
		guestMode = Boolean(context.is_anonymous);
		const contactFields = form.querySelector("[data-registration-contact-fields]");
		contactFields.hidden = false;
		if (context.profile) {
			form.elements.contact_name.value = context.profile.full_name || "";
			form.elements.contact_email.value = context.profile.contact_email || context.profile.email || "";
			form.elements.contact_phone.value = context.profile.contact_phone || "";
		}

		if (context.profile?.account_type === "household") {
			const { data: members, error } = await supabase.from("household_members").select("*").eq("account_id", session.user.id).order("created_at");
			if (error) throw error;
			savedMembers.replaceChildren();
			if (members?.length) {
				savedMembers.hidden = false;
				const memberActions = createElement("div", "pca-saved-member-actions");
				members.forEach((member) => {
					const button = createElement("button", "button small", member.full_name);
					button.type = "button";
					button.dataset.householdMemberButton = member.id;
					button.addEventListener("click", () => addAttendee({
						...member,
						household_member_id: member.id,
					}));
					memberActions.appendChild(button);
				});
				savedMembers.appendChild(memberActions);
				syncAttendeeRows();
			}
		}

		if (!attendeeList.children.length) addAttendee();
	};

	if (registrationId && context.admin_level) {
		await showForm();
	} else if (context.profile?.account_type === "teen_member") {
		chooser.hidden = false;
		chooser.querySelector("[data-registration-teen-warning]").hidden = false;
	} else if (context.profile?.account_type === "household" || guestMode) {
		await showForm();
	} else {
		chooser.hidden = false;
	}

	page.querySelector("[data-register-signin]").href = `login.html?next=${encodeURIComponent(`register.html?event=${eventId}`)}`;
	page.querySelector("[data-register-create-account]").href = `login.html?mode=signup&account=household&next=${encodeURIComponent(`register.html?event=${eventId}`)}`;
	const guestButton = page.querySelector("[data-register-as-guest]");
	let guestStartPromise = null;
	let preparedGuestChallengePromise = null;
	const prepareGuestChallenge = () => {
		if (!preparedGuestChallengePromise) {
			preparedGuestChallengePromise = createTurnstileChallenge(page.querySelector("[data-turnstile-container]"))
				.catch((error) => {
					preparedGuestChallengePromise = null;
					throw error;
				});
		}
		return preparedGuestChallengePromise;
	};
	if (!chooser.hidden) void prepareGuestChallenge().catch(() => {});
	guestButton.addEventListener("click", () => {
		if (guestStartPromise) return;
		guestButton.disabled = true;
		setStatus(status, "Starting secure guest registration...", "info");

		guestStartPromise = (async () => {
			session = await getSession();
			context = session ? await getAccountContext() : {};
			if (session && context.is_anonymous) {
				await showForm();
				setStatus(status);
				return;
			}

			const guestChallenge = await prepareGuestChallenge();
			const captchaToken = await guestChallenge.execute();
			preparedGuestChallengePromise = null;
			const { data, error } = await supabase.auth.signInAnonymously({ options: { captchaToken } });
			if (error) throw error;
			session = data.session;
			context = await getAccountContext();
			await showForm();
			setStatus(status);
		})().catch((error) => {
			preparedGuestChallengePromise = null;
			setStatus(status, friendlyError(error, "Guest registration could not be started."), "error");
			status.scrollIntoView({ behavior: "smooth", block: "center" });
		}).finally(() => {
			guestStartPromise = null;
			if (!chooser.hidden) {
				guestButton.disabled = false;
				void prepareGuestChallenge().catch(() => {});
			}
		});
	});

	page.querySelector("[data-add-attendee]").addEventListener("click", () => {
		addAttendee();
	});

	page.querySelector("[data-registration-next]").addEventListener("click", () => {
		const controls = [...page.querySelectorAll('[data-registration-stage="attendees"] input, [data-registration-stage="attendees"] select, [data-registration-stage="attendees"] textarea')]
			.filter((control) => !control.disabled);
		// Whitespace-only names pass the required check but are rejected by the
		// database, so catch them here with the same wording.
		controls.forEach((control) => {
			if (control.type !== "text") return;
			control.setCustomValidity(control.required && !control.value.trim() ? "Enter a name." : "");
		});
		const invalid = controls.find((control) => !control.checkValidity());
		if (invalid) {
			invalid.reportValidity();
			return;
		}
		if (!attendeeList.children.length) {
			setStatus(status, "Add at least one attendee.", "error");
			return;
		}
		setStatus(status);
		showRegistrationStage("contact");
		page.querySelector(".pca-registration-workflow")?.scrollIntoView({ behavior: "smooth", block: "start" });
	});

	page.querySelector("[data-registration-back]").addEventListener("click", () => {
		showRegistrationStage("attendees");
		page.querySelector(".pca-registration-workflow")?.scrollIntoView({ behavior: "smooth", block: "start" });
	});

	const referral = form.elements.referral_source;
	const referralOtherField = form.querySelector("[data-referral-other-field]");
	const syncReferral = () => {
		const show = referral.value === "other";
		referralOtherField.hidden = !show;
		form.elements.referral_source_other.disabled = !show;
		form.elements.referral_source_other.required = show;
		if (!show) form.elements.referral_source_other.value = "";
	};
	referral.addEventListener("change", syncReferral);
	syncReferral();

	if (editRegistration) {
		attendeeList.replaceChildren(...editAttendees.map((attendee, index) => createAttendeeRow(index, attendee)));
		syncAttendeeRows();
		form.elements.contact_name.value = editRegistration.contact_name || "";
		form.elements.contact_email.value = editRegistration.contact_email || "";
		form.elements.contact_phone.value = editRegistration.contact_phone || "";
		referral.value = editRegistration.referral_source || "";
		form.elements.referral_source_other.value = editRegistration.referral_source_other || "";
		if (form.elements.future_event_emails) form.elements.future_event_emails.checked = Boolean(editRegistration.future_event_emails);
		syncReferral();
		referral.disabled = true;
		referral.required = false;
		form.elements.referral_source_other.disabled = true;
		if (form.elements.future_event_emails) form.elements.future_event_emails.disabled = true;
		const editNote = page.querySelector("[data-registration-edit-note]");
		if (editNote) editNote.hidden = false;
		form.querySelector('[type="submit"]').textContent = "Save Changes";
	}

	form.addEventListener("submit", async (submitEvent) => {
		submitEvent.preventDefault();
		setStatus(status);
		const attendees = [...attendeeList.querySelectorAll("[data-attendee-row]")].map(normalizeAttendee);
		if (!attendees.length) {
			setStatus(status, "Add at least one attendee.", "error");
			return;
		}
		const contact = {
			full_name: form.elements.contact_name.value.trim(),
			email: form.elements.contact_email.value.trim(),
			phone: form.elements.contact_phone.value.trim(),
		};
		setFormBusy(form, true, registrationId ? "Saving..." : "Registering...");
		const result = registrationId
			? await supabase.rpc("update_event_registration", {
				p_registration_id: registrationId,
				p_contact: contact,
				p_attendees: attendees,
			})
			: await supabase.rpc("register_for_event", {
				p_event_id: eventId,
				p_contact: contact,
				p_attendees: attendees,
				p_referral_source: referral.value,
				p_referral_source_other: registrationReferralDetails(referral.value, form.elements.referral_source_other.value),
				p_future_event_emails: Boolean(form.elements.future_event_emails?.checked),
			});
		setFormBusy(form, false);
		if (result.error) {
			setStatus(status, friendlyError(result.error, "The registration could not be saved."), "error");
			return;
		}
		if (registrationId) {
			void supabase.functions.invoke("pca-transactional-email", {
				body: { retry_promotions: true, source_registration_id: registrationId, event_id: eventId },
			})
				.then(({ error: promotionError }) => {
					if (promotionError) console.debug("A waitlist notification remains safely queued.", promotionError);
				});
		}
		form.hidden = true;
		success.hidden = false;
		stepItems.forEach((step) => {
			step.removeAttribute("aria-current");
			step.classList.add("is-complete");
		});
		const saved = Array.isArray(result.data) ? result.data[0] : result.data;
		const savedRegistrationId = registrationId || saved?.registration_id;
		const savedCount = Number(saved?.participant_count) || attendees.length;
		const successTitle = success.querySelector("[data-registration-success-title]");
		if (successTitle) successTitle.textContent = registrationId ? "Changes saved" : saved?.status === "waitlisted" ? "You are on the waitlist" : "Registration complete";
		success.querySelector("[data-registration-result]").textContent = registrationId
			? registrationOutcomeCopy(saved?.status, savedCount)
			: registrationOutcomeCopy(saved?.status, savedCount);
		const attendeeSummary = success.querySelector("[data-registration-success-attendees]");
		if (attendeeSummary) {
			attendeeSummary.replaceChildren(...attendees.map((attendee) => createElement("li", "", attendeeSummaryLine(attendee))));
		}
		const dashboardLink = success.querySelector("[data-registration-dashboard-link]");
		if (dashboardLink) dashboardLink.hidden = context.profile?.account_type !== "household";
		if (saved?.guest_claim_token) {
			sessionStorage.setItem(claimKey, saved.guest_claim_token);
			success.querySelector("[data-guest-account-offer]").hidden = false;
			const conversion = success.querySelector("[data-guest-conversion-form]");
			conversion.elements.full_name.value = contact.full_name;
			conversion.elements.email.value = contact.email;
			conversion.elements.phone.value = contact.phone;
		}
		const emailNote = success.querySelector("[data-registration-email-note]");
		setStatus(status, registrationId ? "Registration changes saved." : "Registration saved.", "success");
		const viewLink = success.querySelector("[data-registration-view-link]");
		const [viewHref, emailResult] = await Promise.all([
			issueViewLink(supabase, savedRegistrationId),
			registrationId ? Promise.resolve(null) : requestTransactionalEmail(supabase, "event_registration_confirmation", savedRegistrationId),
		]);
		if (viewLink) {
			viewLink.hidden = !viewHref;
			if (viewHref) viewLink.href = viewHref;
		}
		if (emailNote) {
			emailNote.textContent = registrationId
				? ""
				: emailResult?.status === "sent"
					? `A confirmation email is on its way to ${contact.email}.`
					: viewHref
						? "Save the registration link below. It shows this registration at any time."
						: "";
			emailNote.hidden = !emailNote.textContent;
		}
	});

	const conversionForm = page.querySelector("[data-guest-conversion-form]");
	conversionForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		const conversionStatus = page.querySelector("[data-guest-conversion-status]");
		const values = new FormData(conversionForm);
		const password = String(values.get("password") || "");
		const passwordMessage = passwordValidationMessage(password);
		if (passwordMessage) {
			setStatus(conversionStatus, passwordMessage, "error");
			return;
		}
		if (password !== String(values.get("password_confirmation") || "")) {
			setStatus(conversionStatus, "The passwords do not match.", "error");
			return;
		}
		setFormBusy(conversionForm, true, "Creating Account...");
		const phone = String(values.get("phone") || "").trim();
		const { data: updatedAccount, error } = await supabase.auth.updateUser({
			email: String(values.get("email") || "").trim(),
			password,
			data: {
				full_name: String(values.get("full_name") || "").trim(),
				account_type: "household",
				account_use: "household",
				contact_phone: phone,
			},
		});
		if (error) {
			setFormBusy(conversionForm, false);
			if (/already|registered|exists/i.test(error.message || "")) {
				await supabase.auth.signOut();
				window.location.assign(`login.html?next=${encodeURIComponent(`register.html?event=${eventId}&claim=1`)}`);
				return;
			}
			setStatus(conversionStatus, friendlyError(error, "The account could not be created."), "error");
			return;
		}
		const completion = await supabase.rpc("complete_household_account", {
			p_full_name: String(values.get("full_name") || "").trim(),
			p_contact_phone: phone,
		});
		setFormBusy(conversionForm, false);
		if (completion.error || updatedAccount.user?.is_anonymous) {
			setStatus(conversionStatus, "Check your email to verify the new account, then sign in to finish attaching this registration.", "info");
			return;
		}
		sessionStorage.removeItem(claimKey);
		setStatus(conversionStatus, "Household account created. This registration is already in your history.", "success");
	});
};

const initializeVolunteerRequestPage = async () => {
	const page = document.querySelector("[data-volunteer-request-page]");
	if (!page) return;
	const status = page.querySelector("[data-volunteer-request-status]");
	const form = page.querySelector("[data-volunteer-request-form]");
	const success = page.querySelector("[data-volunteer-request-success]");
	const eventId = currentEventId();
	const { supabase } = await platformReady();

	if (!eventId) {
		setStatus(status, "Choose an upcoming event before requesting a volunteer spot.", "error");
		form.hidden = true;
		return;
	}

	const { data: event, error: eventError } = await supabase
		.from("events")
		.select("id,title,starts_at,ends_at,event_date,location,published")
		.eq("id", eventId)
		.single();
	if (eventError || !event || !event.published || new Date(event.starts_at) <= new Date()) {
		setStatus(status, "This event is not accepting volunteer requests.", "error");
		form.hidden = true;
		return;
	}

	page.querySelector("[data-volunteer-event-title]").textContent = event.title;
	page.querySelector("[data-volunteer-event-date]").textContent = formatEventRange(event);
	page.querySelector("[data-volunteer-event-location]").textContent = event.location;
	setStatus(status);

	let session = await getSession();
	let context = session ? await getAccountContext() : {};
	if (context.profile) {
		form.elements.full_name.value = context.profile.full_name || "";
		form.elements.email.value = context.profile.contact_email || context.profile.email || "";
		form.elements.phone.value = context.profile.contact_phone || "";
	}

	let challengePromise = null;
	const ensureSession = async () => {
		session = await getSession();
		if (session?.user) return session;
		if (!challengePromise) challengePromise = createTurnstileChallenge(page.querySelector("[data-turnstile-container]"));
		const challenge = await challengePromise;
		const captchaToken = await challenge.execute();
		challengePromise = null;
		const { data, error } = await supabase.auth.signInAnonymously({ options: { captchaToken } });
		if (error) throw error;
		session = data.session;
		return session;
	};
	if (!session?.user) {
		challengePromise = createTurnstileChallenge(page.querySelector("[data-turnstile-container]"))
			.catch((error) => {
				challengePromise = null;
				throw error;
			});
		void challengePromise.catch(() => {});
	}

	form.addEventListener("submit", async (submitEvent) => {
		submitEvent.preventDefault();
		if (!form.reportValidity()) return;
		setStatus(status);
		setFormBusy(form, true, "Sending request...");
		try {
			await ensureSession();
			const values = new FormData(form);
			const { data, error } = await supabase.rpc("submit_event_volunteer_request", {
				p_event_id: eventId,
				p_request: {
					full_name: String(values.get("full_name") || "").trim(),
					email: String(values.get("email") || "").trim(),
					age: Number(values.get("age")),
					phone: String(values.get("phone") || "").trim(),
					school_name: String(values.get("school_name") || "").trim(),
					interests: String(values.get("interests") || "").trim(),
					availability: String(values.get("availability") || "").trim(),
					future_event_emails: values.has("future_event_emails"),
				},
			});
			if (error) throw error;
			const saved = Array.isArray(data) ? data[0] : data;
			await requestTransactionalEmail(supabase, "volunteer_request_received", saved?.request_id);
			form.hidden = true;
			success.hidden = false;
			setStatus(status, "Volunteer request sent. PCA will review it and contact you by email.", "success");
		} catch (error) {
			challengePromise = null;
			setStatus(status, friendlyError(error, "Your volunteer request could not be sent."), "error");
		} finally {
			setFormBusy(form, false);
		}
	});
};

// registration.html: opened from the confirmation email or the success page.
// The token is a capability link, so no session is required.
const initializeRegistrationViewPage = async () => {
	const page = document.querySelector("[data-registration-view]");
	if (!page) return;
	const status = page.querySelector("[data-registration-view-status]");
	const recovery = page.querySelector("[data-registration-view-recovery]");
	const content = page.querySelector("[data-registration-view-content]");
	const token = String(new URLSearchParams(window.location.search).get("token") || "").trim().toLowerCase();
	const { supabase } = await platformReady();

	const fail = (message) => {
		setStatus(status, message, "error");
		if (recovery) recovery.hidden = false;
	};

	if (!isViewToken(token)) {
		fail("This registration link is incomplete. Open the link from your confirmation email, or sign in to see your registrations.");
		return;
	}

	const { data, error } = await supabase.rpc("get_registration_by_token", { p_token: token });
	if (error || !data?.event) {
		fail("This registration link is invalid or has expired. Sign in to your household account to see your registrations, or contact PCA for help.");
		return;
	}

	const event = data.event;
	const statusKey = String(data.status || "");
	page.querySelector("[data-view-event-title]").textContent = event.title || "PCA event";
	const badge = page.querySelector("[data-view-status]");
	badge.textContent = registrationStatusLabels[statusKey] || statusKey;
	badge.className = `pca-status-badge is-${statusKey}`;
	page.querySelector("[data-view-event-date]").textContent = formatEventRange(event);
	page.querySelector("[data-view-event-location]").textContent = event.location || "Location to be announced";
	page.querySelector("[data-view-contact]").textContent = [data.contact_name, data.contact_email, data.contact_phone].filter(Boolean).join(", ");
	page.querySelector("[data-view-registered-at]").textContent = data.created_at ? formatShortDate(data.created_at) : "";

	const attendees = Array.isArray(data.attendees) ? data.attendees : [];
	page.querySelector("[data-view-attendee-heading]").textContent = `Attendees (${attendees.length})`;
	page.querySelector("[data-view-attendees]").replaceChildren(
		...attendees.map((attendee) => createElement("li", "", attendeeSummaryLine(attendee)))
	);

	const note = page.querySelector("[data-view-note]");
	const notes = [];
	if (statusKey === "cancelled") notes.push(`This registration was cancelled${data.cancelled_at ? ` on ${formatShortDate(data.cancelled_at)}` : ""}.`);
	if (statusKey === "waitlisted") notes.push("PCA will email you if space opens up.");
	if (event.deleted) notes.push("This event is no longer listed on the PCA website.");
	note.textContent = notes.join(" ");
	note.hidden = !notes.length;

	const changeCopy = page.querySelector("[data-view-change-copy]");
	const actions = page.querySelector("[data-view-actions]");
	actions.replaceChildren();
	const addAction = (label, href, primary = false) => {
		const item = createElement("li");
		const link = createElement("a", `button${primary ? " primary" : ""}`, label);
		link.href = href;
		item.appendChild(link);
		actions.appendChild(item);
	};
	if (data.owner_is_permanent) {
		changeCopy.textContent = "Attendees and contact details can be changed, and the registration cancelled, from the household dashboard.";
		addAction("Open Household Dashboard", "dashboard.html", true);
	} else {
		changeCopy.textContent = "This registration was made as a guest. To change or cancel it, email PCA and mention the event name and your contact name.";
		const subject = encodeURIComponent(`Registration change: ${event.title || "PCA event"}`);
		addAction("Email PCA", `mailto:pcayouthcenter@gmail.com?subject=${subject}`, true);
	}
	addAction("Upcoming Events", "upcoming-events.html");

	setStatus(status);
	content.hidden = false;
};

export const initializeRegistrationPages = async () => {
	await Promise.all([
		initializeRegistrationPage(),
		initializeRegistrationViewPage(),
		initializeVolunteerRequestPage(),
	]);
};

export { referralLabels };
