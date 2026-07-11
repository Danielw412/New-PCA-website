import {
	createElement,
	currentEventId,
	formatEventRange,
	friendlyError,
	getAccountContext,
	getSession,
	normalizeAttendee,
	platformReady,
	setFormBusy,
	setStatus,
} from "./core-auth.js?v=20260711-guest-registration";

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

const getTurnstileToken = async (container) => {
	const siteKey = document.querySelector('meta[name="pca-turnstile-site-key"]')?.content.trim();
	if (!siteKey) {
		throw new Error("Guest registration is temporarily unavailable because its security check is not configured.");
	}
	const turnstile = await loadTurnstile();
	return new Promise((resolve, reject) => {
		let widgetId;
		let settled = false;
		let fallbackTimeout;
		const cleanup = () => {
			window.clearTimeout(fallbackTimeout);
			if (widgetId !== undefined) {
				try { turnstile.reset(widgetId); } catch (error) { console.debug("Turnstile reset skipped.", error); }
				try { turnstile.remove(widgetId); } catch (error) { console.debug("Turnstile removal skipped.", error); }
			}
			container.replaceWith(container.cloneNode(false));
		};
		const finish = (callback) => {
			if (settled) return;
			settled = true;
			Promise.resolve().then(() => {
				cleanup();
				callback();
			});
		};
		const fail = (message) => finish(() => reject(new Error(message)));

		widgetId = turnstile.render(container, {
			sitekey: siteKey,
			size: "invisible",
			execution: "execute",
			callback: (token) => finish(() => resolve(token)),
			"error-callback": () => fail("The guest security check failed. Please try again."),
			"expired-callback": () => fail("The guest security check expired. Please try again."),
			"timeout-callback": () => fail("The guest security check timed out. Please try again."),
		});
		fallbackTimeout = window.setTimeout(
			() => fail("The guest security check timed out. Please try again."),
			30000
		);
		turnstile.execute(widgetId);
	});
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
	remove.addEventListener("click", () => fieldset.remove());
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
	const status = page.querySelector("[data-platform-registration-status]");
	const content = page.querySelector("[data-platform-registration-content]");
	const chooser = page.querySelector("[data-registration-paths]");
	const form = page.querySelector("[data-platform-registration-form]");
	const attendeeList = page.querySelector("[data-platform-attendees]");
	const savedMembers = page.querySelector("[data-saved-member-picker]");
	const success = page.querySelector("[data-registration-success]");
	const { supabase } = await platformReady();

	if (!eventId) {
		setStatus(status, "Choose an event before opening registration.", "error");
		return;
	}

	const { data: event, error: eventError } = await supabase.from("events").select("*").eq("id", eventId).single();
	if (eventError || !event) {
		setStatus(status, "This event is not available.", "error");
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
	const registrationId = new URLSearchParams(window.location.search).get("registration");
	const claimKey = `pcaGuestClaim:${eventId}`;

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

	const showForm = async () => {
		chooser.hidden = true;
		form.hidden = false;
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
					button.addEventListener("click", () => attendeeList.appendChild(createAttendeeRow(attendeeList.children.length, {
						...member,
						household_member_id: member.id,
					})));
					memberActions.appendChild(button);
				});
				savedMembers.appendChild(memberActions);
			}
		}

		if (!attendeeList.children.length) attendeeList.appendChild(createAttendeeRow(0));
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
	if (!chooser.hidden) void loadTurnstile().catch(() => {});
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

			const captchaToken = await getTurnstileToken(page.querySelector("[data-turnstile-container]"));
			const { data, error } = await supabase.auth.signInAnonymously({ options: { captchaToken } });
			if (error) throw error;
			session = data.session;
			context = await getAccountContext();
			await showForm();
			setStatus(status);
		})().catch((error) => {
			setStatus(status, friendlyError(error, "Guest registration could not be started."), "error");
		}).finally(() => {
			guestStartPromise = null;
			if (!chooser.hidden) guestButton.disabled = false;
		});
	});

	page.querySelector("[data-add-attendee]").addEventListener("click", () => {
		if (attendeeList.children.length >= event.max_participants_per_registration) {
			setStatus(status, `This event allows up to ${event.max_participants_per_registration} attendees per registration.`, "error");
			return;
		}
		attendeeList.appendChild(createAttendeeRow(attendeeList.children.length));
	});

	const referral = form.elements.referral_source;
	const referralOtherField = form.querySelector("[data-referral-other-field]");
	const syncReferral = () => {
		const show = referral.value === "other";
		referralOtherField.hidden = !show;
		form.elements.referral_source_other.disabled = !show;
		form.elements.referral_source_other.required = show;
	};
	referral.addEventListener("change", syncReferral);
	syncReferral();

	if (registrationId && (context.profile?.account_type === "household" || context.admin_level)) {
		let registrationQuery = supabase.from("event_registrations").select("*").eq("id", registrationId);
		if (!context.admin_level) registrationQuery = registrationQuery.eq("owner_user_id", session.user.id);
		const [registrationResult, attendeesResult] = await Promise.all([
			registrationQuery.single(),
			supabase.from("event_registration_attendees").select("*").eq("registration_id", registrationId).order("position"),
		]);
		if (registrationResult.error) throw registrationResult.error;
		if (attendeesResult.error) throw attendeesResult.error;
		const registration = registrationResult.data;
		attendeeList.replaceChildren(...(attendeesResult.data || []).map((attendee, index) => createAttendeeRow(index, attendee)));
		form.elements.contact_name.value = registration.contact_name || "";
		form.elements.contact_email.value = registration.contact_email || "";
		form.elements.contact_phone.value = registration.contact_phone || "";
		referral.value = registration.referral_source || "";
		form.elements.referral_source_other.value = registration.referral_source_other || "";
		syncReferral();
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
				p_referral_source_other: form.elements.referral_source_other.value.trim() || null,
			});
		setFormBusy(form, false);
		if (result.error) {
			setStatus(status, friendlyError(result.error, "The registration could not be saved."), "error");
			return;
		}
		form.hidden = true;
		success.hidden = false;
		const saved = Array.isArray(result.data) ? result.data[0] : result.data;
		const resultStatus = saved?.status || "updated";
		success.querySelector("[data-registration-result]").textContent = registrationId
			? "Your registration changes were saved."
			: `Your group is ${resultStatus}.`;
		if (saved?.guest_claim_token) {
			sessionStorage.setItem(claimKey, saved.guest_claim_token);
			success.querySelector("[data-guest-account-offer]").hidden = false;
			success.querySelector("[data-conversion-email]").value = contact.email;
		}
		setStatus(status, "Registration saved.", "success");
	});

	const conversionForm = page.querySelector("[data-guest-conversion-form]");
	conversionForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		const conversionStatus = page.querySelector("[data-guest-conversion-status]");
		const values = new FormData(conversionForm);
		const password = String(values.get("password") || "");
		if (password !== String(values.get("password_confirmation") || "")) {
			setStatus(conversionStatus, "The passwords do not match.", "error");
			return;
		}
		setFormBusy(conversionForm, true, "Creating Account...");
		const { error } = await supabase.auth.updateUser({
			email: String(values.get("email") || "").trim(),
			password,
			data: { full_name: String(values.get("full_name") || "").trim(), account_type: "household" },
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
			p_contact_phone: String(values.get("phone") || "").trim(),
		});
		setFormBusy(conversionForm, false);
		if (completion.error) {
			setStatus(conversionStatus, "Check your email to verify the new account, then sign in to finish attaching this registration.", "info");
			return;
		}
		sessionStorage.removeItem(claimKey);
		setStatus(conversionStatus, "Household account created. This registration is already in your history.", "success");
	});
};

export const initializeRegistrationPages = async () => {
	await initializeRegistrationPage();
};

export { referralLabels };
