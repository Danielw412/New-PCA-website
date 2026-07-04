(function () {
	"use strict";

	const SUPABASE_URL = "https://ridpqdrikxpwddczdoks.supabase.co";
	const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_tpV455tgoq5uE25f7rHpEQ_ql_zKcfh";
	const SUPABASE_JS_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.min.js";
	const APP_TIME_ZONE = "America/New_York";
	const REFERRAL_SOURCE_LABELS = Object.freeze({
		friend_recommendation: "Friend recommendation",
		wechat_post: "WeChat post",
		facebook_post: "Facebook post",
		instagram: "Instagram",
		flyer: "Flyer",
		poster: "Poster",
		website: "Website",
		email: "Email",
		other: "Other",
	});

	const state = {
		client: null,
		session: null,
		isAdmin: false,
		passwordRecovery: new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery",
		authCallbackError: new URLSearchParams(window.location.hash.slice(1)).get("error_description") || "",
	};

	const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
		dateStyle: "long",
		timeStyle: "short",
		timeZone: APP_TIME_ZONE,
	});

	const shortDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: APP_TIME_ZONE,
	});

	const eventDateFormatter = new Intl.DateTimeFormat("en-US", {
		dateStyle: "medium",
		timeZone: APP_TIME_ZONE,
	});

	const accountDateFormatter = new Intl.DateTimeFormat("en-US", {
		dateStyle: "long",
		timeZone: APP_TIME_ZONE,
	});

	const timeZonePartsFormatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: APP_TIME_ZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});

	const timeZoneParts = (instant) => Object.fromEntries(
		timeZonePartsFormatter
			.formatToParts(instant)
			.filter((part) => part.type !== "literal")
			.map((part) => [part.type, Number(part.value)])
	);

	const timeZoneOffsetMilliseconds = (instant) => {
		const parts = timeZoneParts(instant);
		return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant.getTime();
	};

	const easternDateTimeToIso = (value) => {
		const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);

		if (!match) {
			throw new Error("Choose a valid event date and time.");
		}

		const requested = match.slice(1).map(Number);
		const localAsUtc = Date.UTC(requested[0], requested[1] - 1, requested[2], requested[3], requested[4], 0);
		let utcTime = localAsUtc - timeZoneOffsetMilliseconds(new Date(localAsUtc));
		utcTime = localAsUtc - timeZoneOffsetMilliseconds(new Date(utcTime));
		const instant = new Date(utcTime);
		const resolved = timeZoneParts(instant);
		const roundTrips = resolved.year === requested[0]
			&& resolved.month === requested[1]
			&& resolved.day === requested[2]
			&& resolved.hour === requested[3]
			&& resolved.minute === requested[4];

		if (!roundTrips) {
			throw new Error("That Eastern Time does not exist because of daylight saving time. Choose another time.");
		}

		return instant.toISOString();
	};

	const loadSupabaseLibrary = () => {
		if (window.supabase?.createClient) {
			return Promise.resolve();
		}

		return new Promise((resolve, reject) => {
			const existingScript = document.querySelector('script[data-pca-supabase-library]');

			if (existingScript) {
				existingScript.addEventListener("load", resolve, { once: true });
				existingScript.addEventListener("error", () => reject(new Error("Supabase could not be loaded.")), { once: true });
				return;
			}

			const script = document.createElement("script");
			script.src = SUPABASE_JS_URL;
			script.crossOrigin = "anonymous";
			script.referrerPolicy = "no-referrer";
			script.dataset.pcaSupabaseLibrary = "true";
			script.addEventListener("load", resolve, { once: true });
			script.addEventListener("error", () => reject(new Error("Supabase could not be loaded.")), { once: true });
			document.head.appendChild(script);
		});
	};

	const createElement = (tagName, className, text) => {
		const element = document.createElement(tagName);

		if (className) {
			element.className = className;
		}

		if (typeof text === "string") {
			element.textContent = text;
		}

		return element;
	};

	const currentPageName = () => {
		const pageName = window.location.pathname.split("/").pop();
		return pageName || "index.html";
	};

	const currentRelativeUrl = () => `${currentPageName()}${window.location.search}${window.location.hash}`;

	const safeNextDestination = (fallback = "dashboard.html") => {
		const requestedNext = new URLSearchParams(window.location.search).get("next");

		if (!requestedNext) {
			return fallback;
		}

		try {
			const appRoot = new URL(".", window.location.href);
			const destination = new URL(requestedNext, appRoot);
			const staysInApp = destination.origin === appRoot.origin
				&& destination.pathname.startsWith(appRoot.pathname)
				&& destination.pathname.endsWith(".html");

			if (staysInApp) {
				return `${destination.pathname.split("/").pop()}${destination.search}${destination.hash}`;
			}
		} catch (_error) {
			// Invalid redirect values fall back to the dashboard.
		}

		return fallback;
	};

	const loginUrlFor = (destination) => `login.html?next=${encodeURIComponent(destination)}`;

	const setStatus = (element, message = "", kind = "") => {
		if (!element) {
			return;
		}

		element.textContent = message;
		element.classList.remove("is-error", "is-success", "is-info");

		if (kind) {
			element.classList.add(`is-${kind}`);
		}
	};

	const setFormBusy = (form, isBusy, busyLabel = "Working...") => {
		if (!form) {
			return;
		}

		form.setAttribute("aria-busy", String(isBusy));
		const submit = form.querySelector('button[type="submit"], input[type="submit"]');

		if (!submit) {
			return;
		}

		if (isBusy) {
			if (submit instanceof HTMLInputElement) {
				submit.dataset.originalLabel = submit.value;
				submit.value = busyLabel;
			} else {
				submit.dataset.originalLabel = submit.textContent || "Submit";
				submit.textContent = busyLabel;
			}
		} else if (submit.dataset.originalLabel) {
			if (submit instanceof HTMLInputElement) {
				submit.value = submit.dataset.originalLabel;
			} else {
				submit.textContent = submit.dataset.originalLabel;
			}
		}

		submit.disabled = isBusy;
	};

	const friendlyAuthError = (error, fallback) => {
		const message = String(error?.message || "").toLowerCase();

		if (message.includes("invalid login credentials")) {
			return "The email or password is incorrect.";
		}

		if (message.includes("user already registered")) {
			return "A household account already exists for this email address.";
		}

		if (message.includes("password")) {
			return error.message;
		}

		if (message.includes("rate limit") || message.includes("too many")) {
			return "Too many attempts. Please wait a moment and try again.";
		}

		return fallback;
	};

	const passwordValidationMessage = (password) => {
		if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
			return "Use at least 8 characters with uppercase and lowercase letters and a number.";
		}

		return "";
	};

	const clearAuthCallbackFragment = () => {
		if (!window.location.hash) {
			return;
		}

		window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
	};

	const formatEventRange = (event) => {
		const start = new Date(event.starts_at);
		const end = new Date(event.ends_at);

		if (typeof dateTimeFormatter.formatRange === "function") {
			return dateTimeFormatter.formatRange(start, end);
		}

		return `${dateTimeFormatter.format(start)} – ${dateTimeFormatter.format(end)}`;
	};

	const makeEventDetail = (label, value) => {
		const detail = createElement("div", "pca-event-detail");
		detail.append(createElement("strong", "", label), createElement("span", "", value));
		return detail;
	};

	const getSession = async () => {
		const { data, error } = await state.client.auth.getSession();

		if (error) {
			throw error;
		}

		state.session = data.session;
		return data.session;
	};

	const checkAdmin = async (session = state.session) => {
		if (!session?.user) {
			state.isAdmin = false;
			return false;
		}

		const { data, error } = await state.client
			.from("admin_users")
			.select("user_id")
			.eq("user_id", session.user.id)
			.maybeSingle();

		if (error) {
			console.error("Unable to check administrator access.", error);
			state.isAdmin = false;
			return false;
		}

		state.isAdmin = Boolean(data);
		return state.isAdmin;
	};

	const syncNavigation = async (session = state.session) => {
		const isAdmin = session ? await checkAdmin(session) : false;
		const pageName = currentPageName();
		const linkLists = document.querySelectorAll("#nav .links, #navPanel .links");

		linkLists.forEach((links) => {
			links.querySelectorAll("[data-pca-dynamic-nav]").forEach((item) => item.remove());

			const accountLink = links.querySelector("[data-pca-account-link]")
				|| Array.from(links.querySelectorAll("a")).find((link) => /(?:login|dashboard)\.html(?:$|[?#])/.test(link.getAttribute("href") || ""));

			if (!accountLink) {
				return;
			}

			accountLink.dataset.pcaAccountLink = "true";
			accountLink.href = session ? "dashboard.html" : "login.html";
			accountLink.textContent = session ? "Dashboard" : "Log In";

			const accountItem = accountLink.closest("li");
			accountItem?.classList.add("pca-account-nav");
			accountItem?.classList.toggle("active", pageName === (session ? "dashboard.html" : "login.html"));

			let insertionPoint = accountItem;

			if (session && insertionPoint) {
				const profileItem = createElement("li");
				profileItem.dataset.pcaDynamicNav = "true";
				profileItem.classList.add("pca-profile-nav");
				profileItem.classList.toggle("active", pageName === "profile.html");
				const profileLink = createElement("a", "", "Profile");
				profileLink.href = "profile.html";
				profileItem.appendChild(profileLink);
				insertionPoint.insertAdjacentElement("afterend", profileItem);
				insertionPoint = profileItem;
			}

			if (session && isAdmin && insertionPoint) {
				const adminItem = createElement("li");
				adminItem.dataset.pcaDynamicNav = "true";
				adminItem.classList.add("pca-admin-nav");
				adminItem.classList.toggle("active", pageName === "admin-dashboard.html");
				const adminLink = createElement("a", "", "Admin");
				adminLink.href = "admin-dashboard.html";
				adminItem.appendChild(adminLink);
				insertionPoint.insertAdjacentElement("afterend", adminItem);
				insertionPoint = adminItem;
			}

			if (session && insertionPoint) {
				const signOutItem = createElement("li");
				signOutItem.dataset.pcaDynamicNav = "true";
				signOutItem.classList.add("pca-sign-out-nav");
				const signOutLink = createElement("a", "", "Sign Out");
				signOutLink.href = "#";
				signOutLink.addEventListener("click", async (event) => {
					event.preventDefault();
					signOutLink.textContent = "Signing Out...";
					await state.client.auth.signOut();
					window.location.assign("index.html");
				});
				signOutItem.appendChild(signOutLink);
				insertionPoint.insertAdjacentElement("afterend", signOutItem);
			}
		});
	};

	const requireSession = async () => {
		const session = state.session || await getSession();

		if (!session) {
			window.location.replace(loginUrlFor(currentRelativeUrl()));
			return null;
		}

		return session;
	};

	const initializeLoginPage = async () => {
		const signInForm = document.querySelector("[data-login-form]");

		if (!signInForm) {
			return;
		}

		const signUpForm = document.querySelector("[data-signup-form]");
		const signInStatus = document.querySelector("[data-login-status]");
		const signUpStatus = document.querySelector("[data-signup-status]");
		const authForms = document.querySelector("[data-auth-forms]");
		const authenticatedPanel = document.querySelector("[data-authenticated-panel]");
		const authenticatedEmail = document.querySelector("[data-authenticated-email]");
		const tabs = document.querySelectorAll("[data-auth-tab]");
		const nextDestination = safeNextDestination();
		const loginNotice = document.querySelector("[data-login-notice]");
		const loginQuery = new URLSearchParams(window.location.search);

		if (loginQuery.get("accountDeleted") === "1") {
			loginNotice.hidden = false;
			setStatus(loginNotice, "Your household account and its registration data were permanently deleted.", "success");
		} else if (loginQuery.get("passwordReset") === "1") {
			loginNotice.hidden = false;
			setStatus(loginNotice, "Your password was reset. Sign in with your new password.", "success");
		}

		const showMode = (mode) => {
			const showSignIn = mode === "signin";
			signInForm.hidden = !showSignIn;
			signUpForm.hidden = showSignIn;
			tabs.forEach((tab) => {
				const selected = tab.dataset.authTab === mode;
				tab.classList.toggle("primary", selected);
				tab.setAttribute("aria-selected", String(selected));
			});
			setStatus(signInStatus);
			setStatus(signUpStatus);
		};

		tabs.forEach((tab) => tab.addEventListener("click", () => showMode(tab.dataset.authTab)));

		if (state.session) {
			authForms.hidden = true;
			authenticatedPanel.hidden = false;
			authenticatedEmail.textContent = state.session.user.email || "your account";
		} else {
			authForms.hidden = false;
			authenticatedPanel.hidden = true;
		}

		document.querySelector("[data-login-dashboard]")?.setAttribute("href", nextDestination);
		document.querySelector("[data-login-signout]")?.addEventListener("click", async () => {
			await state.client.auth.signOut();
			window.location.reload();
		});

		signInForm.addEventListener("submit", async (event) => {
			event.preventDefault();
			setStatus(signInStatus);
			setFormBusy(signInForm, true, "Signing In...");

			const formData = new FormData(signInForm);
			const { error } = await state.client.auth.signInWithPassword({
				email: String(formData.get("email") || "").trim(),
				password: String(formData.get("password") || ""),
			});

			if (error) {
				setStatus(signInStatus, friendlyAuthError(error, "We could not sign you in. Please try again."), "error");
				setFormBusy(signInForm, false);
				return;
			}

			setStatus(signInStatus, "Signed in. Taking you to your household account...", "success");
			window.setTimeout(() => window.location.assign(nextDestination), 350);
		});

		signUpForm.addEventListener("submit", async (event) => {
			event.preventDefault();
			setStatus(signUpStatus);

			const formData = new FormData(signUpForm);
			const password = String(formData.get("password") || "");
			const passwordConfirmation = String(formData.get("password_confirmation") || "");

			if (password !== passwordConfirmation) {
				setStatus(signUpStatus, "The passwords do not match.", "error");
				return;
			}

			setFormBusy(signUpForm, true, "Creating Household Account...");
			const { data, error } = await state.client.auth.signUp({
				email: String(formData.get("email") || "").trim(),
				password,
				options: {
					data: {
						full_name: String(formData.get("full_name") || "").trim(),
					},
					emailRedirectTo: new URL(nextDestination, window.location.href).href,
				},
			});

			if (error) {
				setStatus(signUpStatus, friendlyAuthError(error, "We could not create the household account. Please try again."), "error");
				setFormBusy(signUpForm, false);
				return;
			}

			if (data.session) {
				setStatus(signUpStatus, "Household account created. Taking you to your dashboard...", "success");
				window.setTimeout(() => window.location.assign(nextDestination), 450);
				return;
			}

			setStatus(
				signUpStatus,
				"Household account created. Check your email to confirm it, then return here to sign in.",
				"success"
			);
			setFormBusy(signUpForm, false);
		});
	};

	const initializePasswordRecoveryPage = async () => {
		const page = document.querySelector("[data-password-recovery-page]");

		if (!page) {
			return;
		}

		const requestPanel = page.querySelector("[data-recovery-request-panel]");
		const requestForm = page.querySelector("[data-recovery-request-form]");
		const requestStatus = page.querySelector("[data-recovery-request-status]");
		const updatePanel = page.querySelector("[data-recovery-update-panel]");
		const updateForm = page.querySelector("[data-recovery-update-form]");
		const updateStatus = page.querySelector("[data-recovery-update-status]");
		const pageStatus = page.querySelector("[data-recovery-page-status]");
		const recoveryRequested = new URLSearchParams(window.location.search).get("mode") === "recovery";

		const showUpdatePanel = () => {
			if (!state.passwordRecovery || !state.session) {
				return;
			}

			requestPanel.hidden = true;
			updatePanel.hidden = false;
			setStatus(pageStatus);
			clearAuthCallbackFragment();
			updateForm.querySelector('input[name="password"]')?.focus();
		};

		window.addEventListener("pca:password-recovery", showUpdatePanel, { once: true });

		if (state.authCallbackError) {
			setStatus(pageStatus, "This recovery link is invalid or has expired. Request a new link below.", "error");
			clearAuthCallbackFragment();
		} else if (state.passwordRecovery && state.session) {
			showUpdatePanel();
		} else if (recoveryRequested) {
			setStatus(pageStatus, "This recovery link is invalid or has expired. Request a new link below.", "error");
		} else if (state.session) {
			window.location.replace("profile.html");
			return;
		}

		requestForm.addEventListener("submit", async (event) => {
			event.preventDefault();
			setStatus(requestStatus);
			setFormBusy(requestForm, true, "Sending Link...");

			const email = String(new FormData(requestForm).get("email") || "").trim();
			const redirectTo = new URL("reset-password.html?mode=recovery", window.location.href).href;
			const { error } = await state.client.auth.resetPasswordForEmail(email, { redirectTo });

			if (error) {
				setStatus(requestStatus, friendlyAuthError(error, "A recovery link could not be sent. Please wait and try again."), "error");
				setFormBusy(requestForm, false);
				return;
			}

			requestForm.reset();
			setStatus(requestStatus, "If an account exists for that email, a recovery link is on its way. Check your inbox and spam folder.", "success");
			setFormBusy(requestForm, false);
		});

		updateForm.addEventListener("submit", async (event) => {
			event.preventDefault();
			setStatus(updateStatus);

			if (!state.passwordRecovery || !state.session) {
				setStatus(updateStatus, "This recovery session is no longer valid. Request a new recovery link.", "error");
				return;
			}

			const formData = new FormData(updateForm);
			const password = String(formData.get("password") || "");
			const confirmation = String(formData.get("password_confirmation") || "");
			const validationMessage = passwordValidationMessage(password);

			if (validationMessage) {
				setStatus(updateStatus, validationMessage, "error");
				return;
			}

			if (password !== confirmation) {
				setStatus(updateStatus, "The passwords do not match.", "error");
				return;
			}

			setFormBusy(updateForm, true, "Resetting Password...");
			const { error } = await state.client.auth.updateUser({ password });

			if (error) {
				setStatus(updateStatus, friendlyAuthError(error, "Your password could not be reset. Request a new recovery link and try again."), "error");
				setFormBusy(updateForm, false);
				return;
			}

			setStatus(updateStatus, "Password reset. Signing out your active sessions...", "success");
			const { error: signOutError } = await state.client.auth.signOut({ scope: "global" });

			if (signOutError) {
				console.warn("Sessions could not be revoked normally after password recovery.", signOutError);
			}

			state.passwordRecovery = false;
			state.session = null;
			window.setTimeout(() => window.location.replace("login.html?passwordReset=1"), 350);
		});
	};

	const createEventCard = (event, session) => {
		const card = createElement("article", "pca-card pca-event-card");
		card.appendChild(createElement("h3", "", event.title));

		const details = createElement("div", "pca-event-details");
		details.append(
			makeEventDetail("Date & Time", formatEventRange(event)),
			makeEventDetail("Location", event.location)
		);
		card.appendChild(details);

		if (event.description) {
			card.appendChild(createElement("p", "", event.description));
		}

		const registrationMeta = createElement("p", "pca-event-registration-meta");
		const eventStarted = new Date(event.starts_at) <= new Date();
		const canRegister = event.registration_open && !eventStarted;
		registrationMeta.textContent = canRegister
			? `Registration open · Up to ${event.max_participants_per_registration} attendee${event.max_participants_per_registration === 1 ? "" : "s"} per household`
			: "Registration closed";
		card.appendChild(registrationMeta);

		const actions = createElement("ul", "actions");
		const actionItem = createElement("li");

		if (canRegister) {
			const destination = `register.html?event=${encodeURIComponent(event.id)}`;
			const registerLink = createElement("a", "button primary", "Register");
			registerLink.href = session ? destination : loginUrlFor(destination);
			actionItem.appendChild(registerLink);
		} else {
			const closedButton = createElement("span", "button disabled", "Closed");
			closedButton.setAttribute("aria-disabled", "true");
			actionItem.appendChild(closedButton);
		}

		actions.appendChild(actionItem);
		card.appendChild(actions);
		return card;
	};

	const initializeUpcomingEventsPage = async () => {
		const eventList = document.querySelector("[data-events-list]");

		if (!eventList) {
			return;
		}

		const status = document.querySelector("[data-events-status]");
		setStatus(status, "Loading upcoming events...", "info");

		const { data: events, error } = await state.client
			.from("events")
			.select("id,title,description,location,starts_at,ends_at,capacity,max_participants_per_registration,registration_open,published")
			.gte("ends_at", new Date().toISOString())
			.order("starts_at", { ascending: true });

		if (error) {
			setStatus(status, "Upcoming events could not be loaded. Please try again later.", "error");
			return;
		}

		setStatus(status);
		eventList.replaceChildren();

		if (!events?.length) {
			eventList.appendChild(createElement("div", "pca-empty-state", "There are no published upcoming events right now. Please check back soon."));
			return;
		}

		events.forEach((event) => eventList.appendChild(createEventCard(event, state.session)));
	};

	const createParticipantRow = (position, removable) => {
		const row = createElement("fieldset", "pca-participant-row");
		row.dataset.participantRow = "true";
		const legend = createElement("legend", "", `Attendee ${position}`);
		legend.dataset.participantLegend = "true";
		row.appendChild(legend);

		const fields = createElement("div", "fields pca-participant-fields");
		const nameField = createElement("div", "field pca-attendee-name-field");
		const nameId = `participant-name-${Date.now()}-${position}`;
		const nameLabel = createElement("label", "", "Full Name");
		nameLabel.htmlFor = nameId;
		const nameInput = createElement("input");
		nameInput.id = nameId;
		nameInput.name = "participant_name";
		nameInput.type = "text";
		nameInput.maxLength = 120;
		nameInput.autocomplete = "name";
		nameInput.required = true;
		nameField.append(nameLabel, nameInput);

		const typeField = createElement("div", "field");
		const typeId = `participant-type-${Date.now()}-${position}`;
		const typeLabel = createElement("label", "", "Attendee Type");
		typeLabel.htmlFor = typeId;
		const typeSelect = createElement("select");
		typeSelect.id = typeId;
		typeSelect.name = "participant_type";
		typeSelect.required = true;
		const placeholder = createElement("option", "", "Select attendee type");
		placeholder.value = "";
		placeholder.disabled = true;
		placeholder.selected = true;
		typeSelect.appendChild(placeholder);
		[
			["child", "Child / Youth"],
			["adult", "Adult"],
		].forEach(([value, label]) => {
			const option = createElement("option", "", label);
			option.value = value;
			typeSelect.appendChild(option);
		});
		typeField.append(typeLabel, typeSelect);

		const ageField = createElement("div", "field");
		const ageId = `participant-age-${Date.now()}-${position}`;
		const ageLabel = createElement("label", "", "Age");
		ageLabel.htmlFor = ageId;
		const ageInput = createElement("input");
		ageInput.id = ageId;
		ageInput.name = "participant_age";
		ageInput.type = "number";
		ageInput.min = "0";
		ageInput.max = "25";
		ageInput.step = "1";
		ageInput.inputMode = "numeric";
		ageField.append(ageLabel, ageInput);

		const schoolField = createElement("div", "field pca-attendee-school-field");
		const schoolId = `participant-school-${Date.now()}-${position}`;
		const schoolLabel = createElement("label", "", "School / School District");
		schoolLabel.htmlFor = schoolId;
		const schoolInput = createElement("input");
		schoolInput.id = schoolId;
		schoolInput.name = "participant_school_district";
		schoolInput.type = "text";
		schoolInput.maxLength = 160;
		schoolInput.autocomplete = "organization";
		schoolInput.setAttribute("aria-describedby", `${schoolId}-help`);
		const schoolHelp = createElement(
			"small",
			"pca-field-help",
			"Enter a public school district, private school, homeschool, or not yet enrolled."
		);
		schoolHelp.id = `${schoolId}-help`;
		schoolField.append(schoolLabel, schoolInput, schoolHelp);

		const syncChildFields = () => {
			const isChild = typeSelect.value === "child";
			ageField.hidden = !isChild;
			schoolField.hidden = !isChild;
			ageInput.disabled = !isChild;
			schoolInput.disabled = !isChild;
			ageInput.required = isChild;
			schoolInput.required = isChild;

			if (!isChild) {
				ageInput.value = "";
				schoolInput.value = "";
			}
		};

		typeSelect.addEventListener("change", syncChildFields);
		syncChildFields();
		fields.append(nameField, typeField, ageField, schoolField);
		row.appendChild(fields);

		if (removable) {
			const removeButton = createElement("button", "button small pca-remove-participant", "Remove Attendee");
			removeButton.type = "button";
			removeButton.dataset.removeParticipant = "true";
			row.appendChild(removeButton);
		}

		return row;
	};

	const initializeRegistrationPage = async () => {
		const registrationPage = document.querySelector("[data-registration-page]");

		if (!registrationPage) {
			return;
		}

		const session = await requireSession();

		if (!session) {
			return;
		}

		const eventId = new URLSearchParams(window.location.search).get("event");
		const status = document.querySelector("[data-registration-status]");
		const loading = document.querySelector("[data-registration-loading]");
		const content = document.querySelector("[data-registration-content]");

		if (!eventId) {
			setStatus(loading, "No event was selected. Return to Upcoming Events and choose an event.", "error");
			return;
		}

		const [{ data: event, error: eventError }, { data: existing, error: existingError }] = await Promise.all([
			state.client
				.from("events")
				.select("id,title,description,location,starts_at,ends_at,capacity,max_participants_per_registration,registration_open,published")
				.eq("id", eventId)
				.maybeSingle(),
			state.client
				.from("registrations")
				.select("id,status")
				.eq("event_id", eventId)
				.eq("account_id", session.user.id)
				.maybeSingle(),
		]);

		if (eventError || !event) {
			setStatus(loading, "This event is not available.", "error");
			return;
		}

		if (existingError) {
			setStatus(loading, "Your registration status could not be checked. Please try again.", "error");
			return;
		}

		loading.hidden = true;
		content.hidden = false;
		document.querySelector("[data-register-event-title]").textContent = event.title;
		document.querySelector("[data-register-event-date]").textContent = formatEventRange(event);
		document.querySelector("[data-register-event-location]").textContent = event.location;
		document.querySelector("[data-register-event-limit]").textContent = String(event.max_participants_per_registration);

		const form = document.querySelector("[data-registration-form]");
		const participantList = document.querySelector("[data-participant-list]");
		const addButton = document.querySelector("[data-add-participant]");
		const referralSource = document.querySelector("[data-referral-source]");
		const referralOtherField = document.querySelector("[data-referral-other-field]");
		const referralOther = document.querySelector("[data-referral-other]");

		if (existing) {
			form.hidden = true;
			const label = existing.status === "confirmed" ? "confirmed" : "on the waitlist";
			setStatus(status, `This household account is already ${label} for this event. View the registration in your dashboard.`, "info");
			const dashboardLink = createElement("a", "button primary", "View Dashboard");
			dashboardLink.href = "dashboard.html";
			status.insertAdjacentElement("afterend", dashboardLink);
			return;
		}

		const renumberParticipants = () => {
			const rows = participantList.querySelectorAll("[data-participant-row]");
			rows.forEach((row, index) => {
				row.querySelector("[data-participant-legend]").textContent = `Attendee ${index + 1}`;
			});
			addButton.disabled = rows.length >= event.max_participants_per_registration;
		};

		const addParticipant = () => {
			const count = participantList.querySelectorAll("[data-participant-row]").length;

			if (count >= event.max_participants_per_registration) {
				return;
			}

			const row = createParticipantRow(count + 1, count > 0);
			row.querySelector("[data-remove-participant]")?.addEventListener("click", () => {
				row.remove();
				renumberParticipants();
			});
			participantList.appendChild(row);
			renumberParticipants();
		};

		addButton.addEventListener("click", addParticipant);
		addParticipant();

		const syncReferralOther = () => {
			const isOther = referralSource.value === "other";
			referralOtherField.hidden = !isOther;
			referralOther.disabled = !isOther;
			referralOther.required = isOther;

			if (!isOther) {
				referralOther.value = "";
			}
		};

		referralSource.addEventListener("change", syncReferralOther);
		syncReferralOther();

		form.addEventListener("submit", async (submitEvent) => {
			submitEvent.preventDefault();
			setStatus(status);

			const participants = Array.from(participantList.querySelectorAll("[data-participant-row]")).map((row) => ({
				full_name: row.querySelector('[name="participant_name"]').value.trim(),
				attendee_type: row.querySelector('[name="participant_type"]').value,
				age: row.querySelector('[name="participant_age"]')?.value || null,
				school_district: row.querySelector('[name="participant_school_district"]')?.value.trim() || null,
			}));

			setFormBusy(form, true, "Registering...");
			addButton.disabled = true;
			const { data, error } = await state.client.rpc("register_for_event", {
				p_event_id: event.id,
				p_participants: participants,
				p_referral_source: referralSource.value,
				p_referral_source_other: referralSource.value === "other" ? referralOther.value.trim() : null,
			});

			if (error) {
				setStatus(status, error.message || "Registration could not be completed. Please try again.", "error");
				setFormBusy(form, false);
				renumberParticipants();
				return;
			}

			const result = Array.isArray(data) ? data[0] : data;
			const confirmed = result?.status === "confirmed";
			setStatus(
				status,
				confirmed
					? `Registration confirmed for ${result.participant_count} attendee${result.participant_count === 1 ? "" : "s"}.`
					: `The household has been added to the waitlist for ${result.participant_count} attendee${result.participant_count === 1 ? "" : "s"}.`,
				"success"
			);
			form.hidden = true;
			const dashboardLink = createElement("a", "button primary", "View Dashboard");
			dashboardLink.href = "dashboard.html";
			status.insertAdjacentElement("afterend", dashboardLink);
		});
	};

	const makeStatusBadge = (status) => {
		const badge = createElement("span", `pca-status-badge is-${status}`, status === "confirmed" ? "Confirmed" : "Waitlisted");
		return badge;
	};

	const formatReferralSource = (source, otherDetail) => {
		if (!source) {
			return "Not recorded (legacy registration)";
		}

		if (source === "other") {
			return otherDetail ? `Other — ${otherDetail}` : "Other";
		}

		return REFERRAL_SOURCE_LABELS[source] || source;
	};

	const formatAttendeeSummary = (participant) => {
		if (participant.attendee_type === "child") {
			return `${participant.full_name} · Child / Youth, age ${participant.age} · ${participant.school_district}`;
		}

		if (participant.attendee_type === "adult") {
			return `${participant.full_name} · Adult`;
		}

		return `${participant.full_name} · Grade ${participant.grade} (legacy)`;
	};

	const createRegistrationCard = (registration) => {
		const event = registration.event;
		const card = createElement("article", "pca-card pca-registration-card");
		const headingRow = createElement("div", "pca-registration-heading");
		headingRow.append(createElement("h3", "", event.title), makeStatusBadge(registration.status));
		card.appendChild(headingRow);

		const details = createElement("div", "pca-event-details");
		details.append(
			makeEventDetail("Date & Time", formatEventRange(event)),
			makeEventDetail("Location", event.location),
			makeEventDetail("How You Heard", formatReferralSource(registration.referral_source, registration.referral_source_other))
		);
		card.appendChild(details);

		const participantHeading = createElement("h4", "", `Attendees (${registration.participant_count})`);
		const participantList = createElement("ul", "pca-participant-summary");
		const participants = [...(registration.participants || [])].sort((a, b) => a.position - b.position);
		participants.forEach((participant) => {
			participantList.appendChild(createElement("li", "", formatAttendeeSummary(participant)));
		});
		card.append(participantHeading, participantList);
		return card;
	};

	const initializeAccountDeletion = (session) => {
		const form = document.querySelector("[data-account-deletion-form]");

		if (!form) {
			return;
		}

		const passwordInput = form.querySelector('input[name="password"]');
		const confirmationInput = form.querySelector('input[name="confirmation"]');
		const submit = form.querySelector("[data-account-deletion-submit]");
		const status = form.querySelector("[data-account-deletion-status]");

		const updateSubmitState = () => {
			const isBusy = form.getAttribute("aria-busy") === "true";
			submit.disabled = isBusy || confirmationInput.value !== "DELETE";
		};

		confirmationInput.addEventListener("input", updateSubmitState);
		updateSubmitState();

		form.addEventListener("submit", async (event) => {
			event.preventDefault();

			if (form.getAttribute("aria-busy") === "true") {
				return;
			}

			setStatus(status);

			if (confirmationInput.value !== "DELETE") {
				setStatus(status, "Type DELETE exactly before permanently deleting the account.", "error");
				confirmationInput.focus();
				return;
			}

			if (!session.user.email) {
				setStatus(status, "This account does not have an email address that can be verified. Please contact PCA for help.", "error");
				return;
			}

			let deletionCompleted = false;
			setFormBusy(form, true, "Deleting Account...");
			updateSubmitState();
			setStatus(status, "Verifying your password...", "info");

			try {
				const { data: signInData, error: passwordError } = await state.client.auth.signInWithPassword({
					email: session.user.email,
					password: passwordInput.value,
				});

				if (passwordError) {
					const message = String(passwordError.message || "").toLowerCase();
					setStatus(
						status,
						message.includes("invalid login credentials")
							? "The password is incorrect. Your account was not deleted."
							: friendlyAuthError(passwordError, "Your password could not be verified. Your account was not deleted."),
						"error"
					);
					passwordInput.value = "";
					passwordInput.focus();
					return;
				}

				if (signInData.user?.id !== session.user.id) {
					throw new Error("The verified account did not match the active session.");
				}

				setStatus(status, "Password verified. Permanently deleting your account...", "info");
				const { error: deletionError } = await state.client.rpc("delete_own_account");

				if (deletionError) {
					console.error("Account deletion failed.", deletionError);
					const deletionMessage = String(deletionError.message || "").toLowerCase();
					setStatus(
						status,
						deletionMessage.includes("storage") || deletionMessage.includes("object")
							? "Your account has attached files and could not be deleted. Please contact PCA for help."
							: "Your account could not be deleted. Nothing was changed; please try again or contact PCA for help.",
						"error"
					);
					passwordInput.value = "";
					passwordInput.focus();
					return;
				}

				deletionCompleted = true;
				setStatus(status, "Account deleted. Returning to the sign-in page...", "success");

				const { error: signOutError } = await state.client.auth.signOut({ scope: "local" });
				if (signOutError) {
					console.warn("The deleted account session could not be cleared normally.", signOutError);
				}

				state.session = null;
				window.setTimeout(() => window.location.replace("login.html?accountDeleted=1"), 350);
			} catch (error) {
				console.error("Account deletion could not be completed.", error);
				setStatus(status, "Your account could not be deleted. Nothing was changed; please refresh and try again.", "error");
				passwordInput.value = "";
				passwordInput.focus();
			} finally {
				if (!deletionCompleted) {
					setFormBusy(form, false);
					updateSubmitState();
				}
			}
		});
	};

	const initializeProfilePage = async () => {
		const page = document.querySelector("[data-profile-page]");

		if (!page) {
			return;
		}

		const session = await requireSession();

		if (!session) {
			return;
		}

		const pageStatus = page.querySelector("[data-profile-page-status]");
		const content = page.querySelector("[data-profile-content]");
		const summaryName = page.querySelector("[data-profile-summary-name]");
		const summaryEmail = page.querySelector("[data-profile-summary-email]");
		const createdAt = page.querySelector("[data-profile-created-at]");
		const nameForm = page.querySelector("[data-profile-name-form]");
		const nameInput = nameForm.querySelector('input[name="full_name"]');
		const nameStatus = nameForm.querySelector("[data-profile-name-status]");
		const emailForm = page.querySelector("[data-profile-email-form]");
		const emailInput = emailForm.querySelector('input[name="email"]');
		const emailPasswordInput = emailForm.querySelector('input[name="current_password"]');
		const emailStatus = emailForm.querySelector("[data-profile-email-status]");
		const passwordForm = page.querySelector("[data-profile-password-form]");
		const passwordStatus = passwordForm.querySelector("[data-profile-password-status]");
		let currentProfile;

		const renderProfile = (profile) => {
			currentProfile = profile;
			summaryName.textContent = profile.full_name;
			summaryEmail.textContent = profile.email;
			createdAt.textContent = accountDateFormatter.format(new Date(profile.created_at));
			nameInput.value = profile.full_name;
			emailInput.value = "";
			emailInput.placeholder = profile.email;
		};

		const { data: profile, error: profileError } = await state.client
			.from("profiles")
			.select("full_name,email,created_at,updated_at")
			.eq("id", session.user.id)
			.single();

		if (profileError || !profile) {
			console.error("Profile query failed.", profileError);
			setStatus(pageStatus, "Your profile could not be loaded. Please refresh and try again.", "error");
			return;
		}

		renderProfile(profile);
		content.hidden = false;
		initializeAccountDeletion(session);

		const profileQuery = new URLSearchParams(window.location.search);

		if (state.authCallbackError) {
			setStatus(pageStatus, "The email confirmation link is invalid or has expired. Your sign-in email was not changed.", "error");
			clearAuthCallbackFragment();
		} else if (profileQuery.get("emailChange") === "1") {
			setStatus(pageStatus, "Email confirmation processed. If both addresses have been confirmed, the updated sign-in email appears below.", "success");
			clearAuthCallbackFragment();
		} else {
			setStatus(pageStatus);
		}

		nameForm.addEventListener("submit", async (event) => {
			event.preventDefault();
			setStatus(nameStatus);

			const fullName = String(new FormData(nameForm).get("full_name") || "").trim();

			if (!fullName || fullName.length > 120) {
				setStatus(nameStatus, "Enter a contact name between 1 and 120 characters.", "error");
				return;
			}

			if (fullName === currentProfile.full_name) {
				setStatus(nameStatus, "Your contact name is already up to date.", "info");
				return;
			}

			setFormBusy(nameForm, true, "Saving Name...");
			const { data: updatedProfile, error } = await state.client
				.from("profiles")
				.update({ full_name: fullName })
				.eq("id", session.user.id)
				.select("full_name,email,created_at,updated_at")
				.single();

			if (error || !updatedProfile) {
				console.error("Profile name update failed.", error);
				setStatus(nameStatus, "Your contact name could not be saved. Please try again.", "error");
				setFormBusy(nameForm, false);
				return;
			}

			renderProfile(updatedProfile);
			setStatus(nameStatus, "Your household contact name was updated.", "success");
			setFormBusy(nameForm, false);
		});

		emailForm.addEventListener("submit", async (event) => {
			event.preventDefault();
			setStatus(emailStatus);

			const formData = new FormData(emailForm);
			const newEmail = String(formData.get("email") || "").trim();
			const currentPassword = String(formData.get("current_password") || "");

			if (newEmail.toLowerCase() === currentProfile.email.toLowerCase()) {
				setStatus(emailStatus, "Enter a different email address.", "error");
				return;
			}

			setFormBusy(emailForm, true, "Requesting Change...");
			setStatus(emailStatus, "Verifying your password...", "info");

			const { data: signInData, error: passwordError } = await state.client.auth.signInWithPassword({
				email: session.user.email || currentProfile.email,
				password: currentPassword,
			});

			if (passwordError || signInData.user?.id !== session.user.id) {
				setStatus(
					emailStatus,
					String(passwordError?.message || "").toLowerCase().includes("invalid login credentials")
						? "The current password is incorrect. Your email was not changed."
						: friendlyAuthError(passwordError, "Your password could not be verified. Your email was not changed."),
					"error"
				);
				emailPasswordInput.value = "";
				emailPasswordInput.focus();
				setFormBusy(emailForm, false);
				return;
			}

			setStatus(emailStatus, "Password verified. Sending confirmation emails...", "info");
			const emailRedirectTo = new URL("profile.html?emailChange=1", window.location.href).href;
			const { error } = await state.client.auth.updateUser({ email: newEmail }, { emailRedirectTo });

			if (error) {
				setStatus(emailStatus, friendlyAuthError(error, "The email change could not be requested. Please try again."), "error");
				emailPasswordInput.value = "";
				setFormBusy(emailForm, false);
				return;
			}

			emailForm.reset();
			emailInput.placeholder = currentProfile.email;
			setStatus(emailStatus, "Confirmation links were sent to your current and new email addresses. Accept both links to finish the change.", "success");
			setFormBusy(emailForm, false);
		});

		passwordForm.addEventListener("submit", async (event) => {
			event.preventDefault();
			setStatus(passwordStatus);

			const formData = new FormData(passwordForm);
			const currentPassword = String(formData.get("current_password") || "");
			const password = String(formData.get("password") || "");
			const confirmation = String(formData.get("password_confirmation") || "");
			const validationMessage = passwordValidationMessage(password);

			if (validationMessage) {
				setStatus(passwordStatus, validationMessage, "error");
				return;
			}

			if (password !== confirmation) {
				setStatus(passwordStatus, "The new passwords do not match.", "error");
				return;
			}

			if (password === currentPassword) {
				setStatus(passwordStatus, "Choose a new password that differs from your current password.", "error");
				return;
			}

			setFormBusy(passwordForm, true, "Updating Password...");
			const { error } = await state.client.auth.updateUser({ password, currentPassword });

			if (error) {
				setStatus(passwordStatus, friendlyAuthError(error, "Your password could not be updated. Please try again."), "error");
				setFormBusy(passwordForm, false);
				return;
			}

			passwordForm.reset();
			setStatus(passwordStatus, "Your password was updated.", "success");
			setFormBusy(passwordForm, false);
		});
	};

	const initializeUserDashboard = async () => {
		const dashboard = document.querySelector("[data-user-dashboard]");

		if (!dashboard) {
			return;
		}

		const session = await requireSession();

		if (!session) {
			return;
		}

		const status = document.querySelector("[data-dashboard-status]");
		const list = document.querySelector("[data-dashboard-registrations]");
		const footerActions = document.querySelector("[data-dashboard-footer-actions]");
		setStatus(status, "Loading your registrations...", "info");

		const [{ data: profile, error: profileError }, { data: registrations, error: registrationError }] = await Promise.all([
			state.client.from("profiles").select("full_name,email").eq("id", session.user.id).single(),
			state.client
				.from("registrations")
				.select(`
					id,
					status,
					participant_count,
					created_at,
					referral_source,
					referral_source_other,
					event:events!registrations_event_id_fkey(id,title,description,location,starts_at,ends_at),
					participants:registration_participants(id,position,full_name,attendee_type,age,school_district,grade)
				`)
				.eq("account_id", session.user.id)
				.order("created_at", { ascending: false }),
		]);

		if (profileError || registrationError) {
			console.error("Dashboard query failed.", profileError || registrationError);
			setStatus(status, "Your dashboard could not be loaded. Please refresh and try again.", "error");
			return;
		}

		document.querySelector("[data-dashboard-name]").textContent = profile.full_name;
		setStatus(status);
		list.replaceChildren();
		footerActions.hidden = !registrations?.length;

		if (!registrations?.length) {
			const empty = createElement("div", "pca-empty-state");
			empty.appendChild(createElement("p", "", "You have not registered for an event yet."));
			const eventsLink = createElement("a", "button primary", "View Upcoming Events");
			eventsLink.href = "upcoming-events.html";
			empty.appendChild(eventsLink);
			list.appendChild(empty);
			return;
		}

		registrations
			.sort((a, b) => new Date(a.event.starts_at) - new Date(b.event.starts_at))
			.forEach((registration) => list.appendChild(createRegistrationCard(registration)));
	};

	const normalizeAdminRows = (registrations) => registrations.flatMap((registration) => {
		const participants = [...(registration.participants || [])].sort((a, b) => a.position - b.position);
		return participants.map((participant) => ({
			registration_id: registration.id,
			event_id: registration.event.id,
			event_title: registration.event.title,
			event_starts_at: registration.event.starts_at,
			status: registration.status,
			registered_at: registration.created_at,
			account_name: registration.profile.full_name,
			account_email: registration.profile.email,
			participant_name: participant.full_name,
			participant_type: participant.attendee_type || "legacy",
			participant_age: participant.age,
			participant_school_district: participant.school_district,
			participant_legacy_grade: participant.grade,
			participant_position: participant.position,
			referral_source: registration.referral_source,
			referral_source_other: registration.referral_source_other,
		}));
	});

	const csvCell = (value) => {
		const rawValue = String(value ?? "");
		const spreadsheetSafeValue = /^[=+\-@\t\r]/.test(rawValue) ? `'${rawValue}` : rawValue;
		return `"${spreadsheetSafeValue.replace(/"/g, '""')}"`;
	};

	const exportAdminRows = (rows) => {
		const headers = [
			"Event",
			"Event Start (America/New_York)",
			"Status",
			"Household Contact",
			"Household Email",
			"Attendee",
			"Attendee Type",
			"Age",
			"School / School District",
			"Legacy Grade",
			"Referral Source",
			"Referral Other Detail",
			"Registered At (America/New_York)",
			"Registration ID",
		];
		const values = rows.map((row) => [
			row.event_title,
			shortDateTimeFormatter.format(new Date(row.event_starts_at)),
			row.status,
			row.account_name,
			row.account_email,
			row.participant_name,
			row.participant_type === "child" ? "Child / Youth" : row.participant_type === "adult" ? "Adult" : "Legacy record",
			row.participant_age,
			row.participant_school_district,
			row.participant_legacy_grade,
			REFERRAL_SOURCE_LABELS[row.referral_source] || (row.referral_source ? row.referral_source : "Not recorded"),
			row.referral_source_other,
			shortDateTimeFormatter.format(new Date(row.registered_at)),
			row.registration_id,
		]);
		const csv = [headers, ...values].map((row) => row.map(csvCell).join(",")).join("\r\n");
		const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
		const downloadUrl = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = downloadUrl;
		link.download = `pca-registrations-${new Date().toISOString().slice(0, 10)}.csv`;
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(downloadUrl);
	};

	const initializeAdminDashboard = async () => {
		const dashboard = document.querySelector("[data-admin-dashboard]");

		if (!dashboard) {
			return;
		}

		const session = await requireSession();

		if (!session) {
			return;
		}

		const status = document.querySelector("[data-admin-status]");
		const controls = document.querySelector("[data-admin-controls]");
		const tableRegion = document.querySelector("[data-admin-table-region]");
		const accessDenied = document.querySelector("[data-admin-denied]");
		const createPanel = document.querySelector("[data-admin-create-panel]");
		const createForm = document.querySelector("[data-admin-event-form]");
		const createStatus = document.querySelector("[data-admin-create-status]");
		setStatus(status, "Checking administrator access...", "info");

		if (!await checkAdmin(session)) {
			setStatus(status);
			accessDenied.hidden = false;
			return;
		}

		setStatus(status, "Loading registrations...", "info");
		const [{ data: events, error: eventsError }, { data: registrations, error: registrationsError }] = await Promise.all([
			state.client.from("events").select("id,title,starts_at,published").order("starts_at", { ascending: false }),
			state.client
				.from("registrations")
				.select(`
					id,
					status,
					participant_count,
					created_at,
					referral_source,
					referral_source_other,
					event:events!registrations_event_id_fkey(id,title,starts_at),
					profile:profiles!registrations_account_id_fkey(full_name,email),
					participants:registration_participants(id,position,full_name,attendee_type,age,school_district,grade)
				`)
				.order("created_at", { ascending: true }),
		]);

		if (eventsError || registrationsError) {
			console.error("Admin dashboard query failed.", eventsError || registrationsError);
			setStatus(status, "Registrations could not be loaded. Please refresh and try again.", "error");
			return;
		}

		const rows = normalizeAdminRows(registrations || []);
		const eventFilter = document.querySelector("[data-admin-event-filter]");
		const statusFilter = document.querySelector("[data-admin-status-filter]");
		const tableBody = document.querySelector("[data-admin-table-body]");
		const resultCount = document.querySelector("[data-admin-result-count]");
		const exportButton = document.querySelector("[data-admin-export]");

		const addEventFilterOption = (event) => {
			const option = createElement("option", "", `${event.title} — ${eventDateFormatter.format(new Date(event.starts_at))}`);
			option.value = event.id;
			eventFilter.appendChild(option);
		};

		(events || []).forEach(addEventFilterOption);

		let filteredRows = rows;

		const renderRows = () => {
			filteredRows = rows.filter((row) => {
				const matchesEvent = !eventFilter.value || row.event_id === eventFilter.value;
				const matchesStatus = !statusFilter.value || row.status === statusFilter.value;
				return matchesEvent && matchesStatus;
			});

			tableBody.replaceChildren();
			resultCount.textContent = `${filteredRows.length} attendee${filteredRows.length === 1 ? "" : "s"}`;
			exportButton.disabled = filteredRows.length === 0;

			if (!filteredRows.length) {
				const row = createElement("tr");
				const cell = createElement("td", "pca-admin-empty", "No registrations match these filters.");
				cell.colSpan = 9;
				row.appendChild(cell);
				tableBody.appendChild(row);
				return;
			}

			filteredRows.forEach((rowData) => {
				const row = createElement("tr");
				const eventCell = createElement("td");
				eventCell.append(
					createElement("strong", "", rowData.event_title),
					createElement("span", "pca-table-subtext", shortDateTimeFormatter.format(new Date(rowData.event_starts_at)))
				);
				const statusCell = createElement("td");
				statusCell.appendChild(makeStatusBadge(rowData.status));
				const contactCell = createElement("td");
				contactCell.append(
					createElement("strong", "", rowData.account_name),
					createElement("a", "pca-table-subtext", rowData.account_email)
				);
				contactCell.querySelector("a").href = `mailto:${rowData.account_email}`;
				const attendeeType = rowData.participant_type === "child"
					? "Child / Youth"
					: rowData.participant_type === "adult" ? "Adult" : "Legacy record";
				const ageOrLegacyGrade = rowData.participant_type === "legacy"
					? `Grade ${rowData.participant_legacy_grade}`
					: rowData.participant_type === "child" ? String(rowData.participant_age) : "—";
				row.append(
					eventCell,
					statusCell,
					contactCell,
					createElement("td", "", rowData.participant_name),
					createElement("td", "", attendeeType),
					createElement("td", "", ageOrLegacyGrade),
					createElement("td", "", rowData.participant_school_district || "—"),
					createElement("td", "", formatReferralSource(rowData.referral_source, rowData.referral_source_other)),
					createElement("td", "", shortDateTimeFormatter.format(new Date(rowData.registered_at)))
				);
				tableBody.appendChild(row);
			});
		};

		eventFilter.addEventListener("change", renderRows);
		statusFilter.addEventListener("change", renderRows);
		exportButton.addEventListener("click", () => exportAdminRows(filteredRows));
		createForm.addEventListener("submit", async (submitEvent) => {
			submitEvent.preventDefault();
			setStatus(createStatus);

			try {
				const formData = new FormData(createForm);
				const startsAt = easternDateTimeToIso(String(formData.get("starts_at") || ""));
				const endsAt = easternDateTimeToIso(String(formData.get("ends_at") || ""));
				const capacity = Number(formData.get("capacity"));
				const groupLimit = Number(formData.get("max_participants_per_registration"));

				if (new Date(endsAt) <= new Date(startsAt)) {
					throw new Error("The event end time must be after its start time.");
				}

				if (groupLimit > capacity) {
					throw new Error("The maximum per registration cannot exceed the event capacity.");
				}

				setFormBusy(createForm, true, "Creating...");
				const { data: createdEvent, error } = await state.client
					.from("events")
					.insert({
						title: String(formData.get("title") || "").trim(),
						description: String(formData.get("description") || "").trim(),
						location: String(formData.get("location") || "").trim(),
						starts_at: startsAt,
						ends_at: endsAt,
						capacity,
						max_participants_per_registration: groupLimit,
						registration_open: formData.has("registration_open"),
						published: formData.has("published"),
					})
					.select("id,title,starts_at,published")
					.single();

				if (error) {
					throw error;
				}

				addEventFilterOption(createdEvent);
				createForm.reset();
				setStatus(
					createStatus,
					`${createdEvent.title} was created${createdEvent.published ? " and published" : " as a draft"}.`,
					"success"
				);
			} catch (error) {
				console.error("Event creation failed.", error);
				setStatus(createStatus, error.message || "The event could not be created. Please try again.", "error");
			} finally {
				setFormBusy(createForm, false);
			}
		});
		setStatus(status);
		createPanel.hidden = false;
		controls.hidden = false;
		tableRegion.hidden = false;
		renderRows();
	};

	const showBackendFailure = (error) => {
		console.error("PCA backend initialization failed.", error);
		document.querySelectorAll("[data-backend-status]").forEach((element) => {
			setStatus(element, "The registration service is temporarily unavailable. Please refresh or try again later.", "error");
			element.hidden = false;
		});
	};

	const initialize = async () => {
		await loadSupabaseLibrary();

		if (!window.supabase?.createClient) {
			throw new Error("The Supabase browser client did not initialize.");
		}

		state.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
			auth: {
				persistSession: true,
				autoRefreshToken: true,
				detectSessionInUrl: true,
			},
		});

		state.client.auth.onAuthStateChange((authEvent, session) => {
			state.session = session;

			if (authEvent === "PASSWORD_RECOVERY") {
				state.passwordRecovery = true;
				window.dispatchEvent(new CustomEvent("pca:password-recovery"));
			}

			window.setTimeout(() => syncNavigation(session), 0);
		});

		await getSession();
		await syncNavigation(state.session);

		window.PCA = {
			supabase: state.client,
			getSession,
			checkAdmin,
		};

		await Promise.all([
			initializeLoginPage(),
			initializePasswordRecoveryPage(),
			initializeUpcomingEventsPage(),
			initializeRegistrationPage(),
			initializeUserDashboard(),
			initializeProfilePage(),
			initializeAdminDashboard(),
		]);

		document.dispatchEvent(new CustomEvent("pca:backend-ready", {
			detail: {
				signedIn: Boolean(state.session),
				isAdmin: state.isAdmin,
			},
		}));
	};

	initialize().catch(showBackendFailure);
})();
