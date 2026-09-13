(function () {
	"use strict";

	const SUPABASE_URL = "https://ridpqdrikxpwddczdoks.supabase.co";
	const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_tpV455tgoq5uE25f7rHpEQ_ql_zKcfh";
	const SUPABASE_JS_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.0/dist/umd/supabase.min.js";
	const APP_TIME_ZONE = "America/New_York";

	const state = {
		client: null,
		session: null,
		isAdmin: false,
		accountUse: null,
		volunteerSubmissionNotified: false,
		passwordRecovery: new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery",
		authCallbackError: new URLSearchParams(window.location.hash.slice(1)).get("error_description") || "",
	};

	const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
		dateStyle: "long",
		timeStyle: "short",
		timeZone: APP_TIME_ZONE,
	});

	const eventDateFormatter = new Intl.DateTimeFormat("en-US", {
		dateStyle: "medium",
		timeZone: APP_TIME_ZONE,
	});

	const eventDateOnlyFormatter = new Intl.DateTimeFormat("en-US", {
		dateStyle: "long",
		timeZone: "UTC",
	});

	const parseDateOnly = (value) => {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
		if (!match) return null;
		const [, year, month, day] = match;
		return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
	};

	const formatDateOnly = (value) => {
		const date = parseDateOnly(value);
		return date ? eventDateOnlyFormatter.format(date) : "";
	};

	const accountDateFormatter = new Intl.DateTimeFormat("en-US", {
		dateStyle: "long",
		timeZone: APP_TIME_ZONE,
	});

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
			return "We couldn't sign you in. Check your email and password, or use Forgot your password? to reset it.";
		}

		if (message.includes("user already registered")) {
			return "A PCA account already exists for this email address.";
		}

		if (message.includes("password")) {
			return "Choose a password with at least 8 characters, including an uppercase letter, a lowercase letter, and a number.";
		}

		if (message.includes("rate limit") || message.includes("too many")) {
			return "Too many attempts. Please wait a moment and try again.";
		}

		return fallback;
	};

	const passwordValidationMessage = (password) => {
		if (password.length < 8 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
			return "Your password needs at least 8 characters, with one uppercase letter, one lowercase letter, and one number.";
		}

		return "";
	};

	const passwordUpdatePayload = (password, currentPassword) => ({
		password,
		current_password: currentPassword,
	});

	const clearAuthCallbackFragment = () => {
		if (!window.location.hash) {
			return;
		}

		window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
	};

	const formatEventRange = (event) => {
		if (event?.starts_at && event?.ends_at) {
			const start = new Date(event.starts_at);
			const end = new Date(event.ends_at);

			if (typeof dateTimeFormatter.formatRange === "function") {
				return dateTimeFormatter.formatRange(start, end);
			}

			return `${dateTimeFormatter.format(start)} – ${dateTimeFormatter.format(end)}`;
		}

		return event?.starts_at
			? dateTimeFormatter.format(new Date(event.starts_at))
			: formatDateOnly(event?.event_date) || "Date not listed";
	};

	const formatEventMeta = (event) => [
		event?.starts_at ? formatEventRange(event) : formatDateOnly(event?.event_date),
		event?.location || "",
	].filter(Boolean).join(" · ");

	const getSession = async () => {
		const { data, error } = await state.client.auth.getSession();

		if (error) {
			throw error;
		}

		state.session = data.session;
		return data.session;
	};

	const isPermanentSession = (session = state.session) => Boolean(session?.user && !session.user.is_anonymous && session.user.email);
	const isAnonymousSession = (session = state.session) => Boolean(session?.user?.is_anonymous);
	const canRegisterForHouseholdEvent = (session = state.session) => (
		!session?.user
		|| isAnonymousSession(session)
		|| (isPermanentSession(session) && state.accountUse === "household")
	);

	const loadAccountUse = async (session = state.session) => {
		if (!session?.user) {
			state.accountUse = null;
			return null;
		}

		const { data, error } = await state.client.rpc("get_account_context");

		if (error) {
			throw error;
		}

		state.accountUse = data?.profile?.account_type === "teen_member"
			? "volunteer"
			: data?.profile?.account_type || null;
		return state.accountUse;
	};

	const notifyVolunteerApplication = async (session = state.session) => {
		if (!session?.user || state.accountUse !== "volunteer" || state.volunteerSubmissionNotified) return;
		state.volunteerSubmissionNotified = true;

		const { data: application, error } = await state.client
			.from("volunteer_applications")
			.select("id")
			.eq("user_id", session.user.id)
			.eq("status", "pending")
			.maybeSingle();

		if (error || !application?.id) {
			state.volunteerSubmissionNotified = false;
			return;
		}

		const { error: notificationError } = await state.client.functions.invoke("pca-transactional-email", {
			body: { kind: "volunteer_account_submitted", resource_id: application.id },
		});

		if (notificationError) {
			state.volunteerSubmissionNotified = false;
			console.debug("Volunteer application email delivery remains queued.", notificationError);
		}
	};

	const accountDashboardDestination = () => state.accountUse === "volunteer"
		? "volunteer-dashboard.html"
		: "dashboard.html";

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
		const permanentSession = isPermanentSession(session);
		const isAdmin = permanentSession ? await checkAdmin(session) : false;
		const pageName = currentPageName();
		const accountMenus = document.querySelectorAll("[data-pca-account-menu]");

		if (accountMenus.length) {
			const dashboardDestination = accountDashboardDestination();
			const accountPages = new Set([
				"login.html",
				"reset-password.html",
				"dashboard.html",
				"profile.html",
				"admin-dashboard.html",
				"volunteer-account-apply.html",
				"volunteer-dashboard.html",
				"volunteer-account-apply.html",
				"volunteer-dashboard.html",
			]);

			accountMenus.forEach((menu) => {
				const accountLink = menu.querySelector("[data-pca-account-link]");
				const actions = menu.querySelector("[data-pca-account-actions]");
				const toggle = menu.querySelector(".nav-account__row > button");

				if (!accountLink || !actions) return;

				accountLink.href = permanentSession ? dashboardDestination : "login.html";
				accountLink.textContent = permanentSession ? "My Account" : "Sign In";
				menu.classList.toggle("is-current", accountPages.has(pageName));
				actions.replaceChildren();

				const appendAction = (label, href, className, active, listener) => {
					const item = createElement("li", className);
					item.dataset.pcaDynamicNav = "true";
					item.classList.toggle("active", active);
					const link = createElement("a", "", label);
					link.href = href;
					if (listener) link.addEventListener("click", listener);
					item.appendChild(link);
					actions.appendChild(item);
				};

				if (permanentSession) {
					appendAction("Profile", "profile.html", "pca-profile-nav", pageName === "profile.html");
					if (isAdmin) appendAction("Admin", "admin-dashboard.html", "pca-admin-nav", pageName === "admin-dashboard.html");
					appendAction("Sign Out", "#", "pca-sign-out-nav", false, async (event) => {
						event.preventDefault();
						const signOutLink = event.currentTarget;
						signOutLink.textContent = "Signing Out...";
						await state.client.auth.signOut();
						window.location.assign("index.html");
					});
				}

				if (toggle) {
					toggle.hidden = actions.childElementCount === 0;
					menu.classList.toggle("has-account-actions", actions.childElementCount > 0);
					if (toggle.hidden) {
						toggle.setAttribute("aria-expanded", "false");
						menu.classList.remove("is-open");
					}
				}
			});

			document.dispatchEvent(new CustomEvent("pca:navigation-updated"));
			return;
		}

		const linkLists = document.querySelectorAll("#nav .links, #navPanel .links");

		linkLists.forEach((links) => {
			links.querySelectorAll("[data-pca-dynamic-nav]").forEach((item) => item.remove());

			const accountLink = links.querySelector("[data-pca-account-link]")
				|| Array.from(links.querySelectorAll("a")).find((link) => /(?:login|dashboard)\.html(?:$|[?#])/.test(link.getAttribute("href") || ""));

			if (!accountLink) {
				return;
			}

			accountLink.dataset.pcaAccountLink = "true";
			const dashboardDestination = accountDashboardDestination();
			accountLink.href = permanentSession ? dashboardDestination : "login.html";
			accountLink.textContent = permanentSession ? "My Account" : "Sign In";

			const accountItem = accountLink.closest("li");
			accountItem?.classList.add("pca-account-nav");
			accountItem?.classList.toggle("active", pageName === (permanentSession ? dashboardDestination : "login.html"));

			let insertionPoint = accountItem;

			if (permanentSession && insertionPoint) {
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

			if (permanentSession && isAdmin && insertionPoint) {
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

			if (permanentSession && insertionPoint) {
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
		const signInPanel = document.querySelector("[data-signin-panel]") || signInForm;
		const signInStatus = document.querySelector("[data-login-status]");
		const signUpStatus = document.querySelector("[data-signup-status]");
		const otpRequestForm = document.querySelector("[data-otp-request-form]");
		const otpVerifyForm = document.querySelector("[data-otp-verify-form]");
		const otpRequestStatus = document.querySelector("[data-otp-request-status]");
		const otpVerifyStatus = document.querySelector("[data-otp-verify-status]");
		const authForms = document.querySelector("[data-auth-forms]");
		const authenticatedPanel = document.querySelector("[data-authenticated-panel]");
		const authenticatedEmail = document.querySelector("[data-authenticated-email]");
		const tabs = document.querySelectorAll("[data-auth-tab]");
		const loginNotice = document.querySelector("[data-login-notice]");
		const loginQuery = new URLSearchParams(window.location.search);
		const hasRequestedNext = loginQuery.has("next");
		const requestedAccountUse = ["teen_member", "volunteer"].includes(loginQuery.get("account")) ? "teen_member" : "household";
		const destinationFor = (accountUse = state.accountUse) => hasRequestedNext
			? safeNextDestination(["teen_member", "volunteer"].includes(accountUse) ? "volunteer-dashboard.html" : "dashboard.html")
			: ["teen_member", "volunteer"].includes(accountUse) ? "volunteer-dashboard.html" : "dashboard.html";

		if (loginQuery.get("accountDeleted") === "1") {
			loginNotice.hidden = false;
			setStatus(loginNotice, "Your PCA account and its associated data were permanently deleted.", "success");
		} else if (loginQuery.get("passwordReset") === "1") {
			loginNotice.hidden = false;
			setStatus(loginNotice, "Your password was reset. Sign in with your new password.", "success");
		}

		const showMode = (mode) => {
			const showSignIn = mode === "signin";
			signInPanel.hidden = !showSignIn;
			signUpForm.hidden = showSignIn;
			tabs.forEach((tab) => {
				const selected = tab.dataset.authTab === mode;
				tab.classList.toggle("primary", selected);
				tab.classList.toggle("is-selected", selected);
				tab.setAttribute("aria-selected", String(selected));
				tab.tabIndex = selected ? 0 : -1;
			});
			setStatus(signInStatus);
			setStatus(signUpStatus);
		};

		tabs.forEach((tab, index) => {
			tab.addEventListener("click", () => showMode(tab.dataset.authTab));
			tab.addEventListener("keydown", (event) => {
				if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
				event.preventDefault();
				let nextIndex = event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : (index + 1) % tabs.length;
				if (event.key === "Home") nextIndex = 0;
				if (event.key === "End") nextIndex = tabs.length - 1;
				showMode(tabs[nextIndex].dataset.authTab);
				tabs[nextIndex].focus();
			});
		});

		if (loginQuery.get("mode") === "signup") {
			showMode("signup");
		}

		const requestedAccountOption = signUpForm.querySelector(`input[name="account_use"][value="${requestedAccountUse}"]`);
		if (requestedAccountOption) {
			requestedAccountOption.checked = true;
		}

		const volunteerFields = signUpForm.querySelector("[data-volunteer-signup-fields]");
		const syncVolunteerFields = () => {
			const volunteerSelected = signUpForm.elements.account_use?.value === "teen_member";
			if (!volunteerFields) return;
			volunteerFields.hidden = !volunteerSelected;
			volunteerFields.querySelectorAll("input").forEach((input) => {
				input.disabled = !volunteerSelected;
				input.required = volunteerSelected;
			});
		};
		signUpForm.querySelectorAll('input[name="account_use"]').forEach((option) => {
			option.addEventListener("change", syncVolunteerFields);
		});
		syncVolunteerFields();

		if (isPermanentSession(state.session)) {
			authForms.hidden = true;
			authenticatedPanel.hidden = false;
			authenticatedEmail.textContent = state.session.user.email || "your account";
		} else {
			authForms.hidden = false;
			authenticatedPanel.hidden = true;
		}

		document.querySelector("[data-login-dashboard]")?.setAttribute("href", destinationFor());
		document.querySelector("[data-login-signout]")?.addEventListener("click", async () => {
			await state.client.auth.signOut();
			window.location.reload();
		});

		signInForm.addEventListener("submit", async (event) => {
			event.preventDefault();
			setStatus(signInStatus);
			setFormBusy(signInForm, true, "Signing In...");

			const formData = new FormData(signInForm);
			const { data, error } = await state.client.auth.signInWithPassword({
				email: String(formData.get("email") || "").trim(),
				password: String(formData.get("password") || ""),
			});

			if (error) {
				setStatus(signInStatus, friendlyAuthError(error, "We could not sign you in. Please try again."), "error");
				setFormBusy(signInForm, false);
				return;
			}

			await loadAccountUse(data.session);
			const nextDestination = destinationFor();
			setStatus(signInStatus, "Signed in. Taking you to your dashboard...", "success");
			window.setTimeout(() => window.location.assign(nextDestination), 350);
		});

		// One-time code sign-in. The code and the link in the same email both
		// work: verifyOtp consumes the code here, and the link lands back on
		// this site where the client picks the session out of the URL.
		if (otpRequestForm && otpVerifyForm) {
			let otpEmail = "";
			const showSignInStep = (step) => {
				signInForm.hidden = step !== "password";
				otpRequestForm.hidden = step !== "request";
				otpVerifyForm.hidden = step !== "verify";
				setStatus(signInStatus);
				setStatus(otpRequestStatus);
				setStatus(otpVerifyStatus);
				const focusTarget = step === "password"
					? signInForm.querySelector('input[name="email"]')
					: step === "request"
						? otpRequestForm.querySelector('input[name="email"]')
						: otpVerifyForm.querySelector('input[name="token"]');
				focusTarget?.focus();
			};

			const friendlyOtpError = (error, fallback) => {
				const message = String(error?.message || "").toLowerCase();
				if (message.includes("signups not allowed") || message.includes("user not found")) {
					return "We couldn't find a PCA account with that email. Check the address or create an account.";
				}
				if (message.includes("expired") || message.includes("invalid") || message.includes("token")) {
					return "That code is incorrect or has expired. Check the newest email from PCA or request a new code.";
				}
				if (message.includes("rate limit") || message.includes("too many") || message.includes("security purposes")) {
					return "Please wait a minute before requesting another code.";
				}
				return friendlyAuthError(error, fallback);
			};

			const requestCode = async (form, statusElement) => {
				if (!otpEmail) return;
				setStatus(statusElement, "Sending your code...", "info");
				setFormBusy(form, true, "Sending...");
				const { error } = await state.client.auth.signInWithOtp({
					email: otpEmail,
					options: {
						shouldCreateUser: false,
						emailRedirectTo: new URL(destinationFor(), window.location.href).href,
					},
				});
				setFormBusy(form, false);
				if (error) {
					setStatus(statusElement, friendlyOtpError(error, "The code could not be sent. Please try again."), "error");
					return false;
				}
				return true;
			};

			document.querySelector("[data-otp-start]")?.addEventListener("click", () => {
				const typedEmail = String(signInForm.querySelector('input[name="email"]')?.value || "").trim();
				if (typedEmail) otpRequestForm.querySelector('input[name="email"]').value = typedEmail;
				showSignInStep("request");
			});

			document.querySelectorAll("[data-otp-use-password]").forEach((button) => {
				button.addEventListener("click", () => showSignInStep("password"));
			});

			document.querySelector("[data-otp-change-email]")?.addEventListener("click", () => showSignInStep("request"));

			otpRequestForm.addEventListener("submit", async (event) => {
				event.preventDefault();
				otpEmail = String(new FormData(otpRequestForm).get("email") || "").trim();
				if (!(await requestCode(otpRequestForm, otpRequestStatus))) return;
				otpVerifyForm.querySelector("[data-otp-email]").textContent = otpEmail;
				otpVerifyForm.reset();
				showSignInStep("verify");
				setStatus(otpVerifyStatus, "Code sent. Check your inbox and spam folder.", "success");
			});

			document.querySelector("[data-otp-resend]")?.addEventListener("click", async (event) => {
				const button = event.currentTarget;
				button.disabled = true;
				const sent = await requestCode(otpVerifyForm, otpVerifyStatus);
				if (sent) setStatus(otpVerifyStatus, "A new code is on its way. Only the newest code works.", "success");
				window.setTimeout(() => { button.disabled = false; }, 15000);
			});

			otpVerifyForm.addEventListener("submit", async (event) => {
				event.preventDefault();
				const token = String(new FormData(otpVerifyForm).get("token") || "").replace(/\s+/g, "");
				if (!otpEmail || !/^\d{6,10}$/.test(token)) {
					setStatus(otpVerifyStatus, "Enter the numeric code from your email.", "error");
					return;
				}
				setStatus(otpVerifyStatus, "Checking your code...", "info");
				setFormBusy(otpVerifyForm, true, "Signing In...");
				const { data, error } = await state.client.auth.verifyOtp({ email: otpEmail, token, type: "email" });
				if (error || !data?.session) {
					setStatus(otpVerifyStatus, friendlyOtpError(error, "The code could not be verified. Please try again."), "error");
					setFormBusy(otpVerifyForm, false);
					return;
				}
				state.session = data.session;
				await loadAccountUse(data.session);
				setStatus(otpVerifyStatus, "Signed in. Taking you to your dashboard...", "success");
				window.setTimeout(() => window.location.assign(destinationFor()), 350);
			});
		}

		signUpForm.addEventListener("submit", async (event) => {
			event.preventDefault();
			setStatus(signUpStatus);

			const formData = new FormData(signUpForm);
			const password = String(formData.get("password") || "");
			const passwordConfirmation = String(formData.get("password_confirmation") || "");
			const validationMessage = passwordValidationMessage(password);

			if (validationMessage) {
				setStatus(signUpStatus, validationMessage, "error");
				return;
			}

			if (password !== passwordConfirmation) {
				setStatus(signUpStatus, "The passwords do not match.", "error");
				return;
			}

			const accountUse = String(formData.get("account_use") || "household");
			const nextDestination = destinationFor(accountUse);
			setFormBusy(signUpForm, true, "Creating Account...");
			const { data, error } = await state.client.auth.signUp({
				email: String(formData.get("email") || "").trim(),
				password,
				options: {
					data: {
						full_name: String(formData.get("full_name") || "").trim(),
						account_type: accountUse,
						account_use: accountUse === "teen_member" ? "volunteer" : "household",
						...(accountUse === "teen_member" ? {
							age: Number(formData.get("age")),
							contact_phone: String(formData.get("phone") || "").trim(),
							phone: String(formData.get("phone") || "").trim(),
							school_name: String(formData.get("school_name") || "").trim(),
						} : {}),
					},
					emailRedirectTo: new URL(nextDestination, window.location.href).href,
				},
			});

			if (error) {
				setStatus(signUpStatus, friendlyAuthError(error, "We could not create the account. Please try again."), "error");
				setFormBusy(signUpForm, false);
				return;
			}

			if (data.session) {
				state.session = data.session;
				await loadAccountUse(data.session);
				void notifyVolunteerApplication(data.session);
				setStatus(signUpStatus, accountUse === "teen_member" ? "Application received. Taking you to your Volunteer dashboard..." : "Account created. Taking you to your dashboard...", "success");
				window.setTimeout(() => window.location.assign(nextDestination), 450);
				return;
			}

			setStatus(
				signUpStatus,
				"Account created. Check your email to confirm it, then return here to sign in.",
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
		const card = createElement("article", "pca-card pca-event-card pca-event-agenda");
		const start = event.starts_at ? new Date(event.starts_at) : parseDateOnly(event.event_date);
		const dateTimeZone = event.starts_at ? APP_TIME_ZONE : "UTC";
		const date = createElement("time", "pca-event-agenda__date");
		date.dateTime = event.starts_at || event.event_date || "";
		if (start) {
			date.append(
				createElement("span", "pca-event-agenda__month", start.toLocaleDateString("en-US", { month: "short", timeZone: dateTimeZone })),
				createElement("span", "pca-event-agenda__day", start.toLocaleDateString("en-US", { day: "numeric", timeZone: dateTimeZone })),
				createElement("span", "pca-event-agenda__year", start.toLocaleDateString("en-US", { year: "numeric", timeZone: dateTimeZone }))
			);
		}
		const body = createElement("div", "pca-event-agenda__body");
		body.appendChild(createElement("p", "pca-event-agenda__kicker", event.lifecycle === "in_progress" ? "Happening now" : "Next PCA event"));
		body.appendChild(createElement("h2", "", event.title));
		const meta = formatEventMeta(event);
		if (meta) body.appendChild(createElement("p", "pca-event-agenda__meta", meta));

		if (event.description) {
			body.appendChild(createElement("p", "", event.description));
		}

		const registrationMeta = createElement("p", "pca-event-registration-meta");
		const eventStarted = !event.starts_at || new Date(event.starts_at) <= new Date();
		const canRegister = typeof event.registration_available === "boolean"
			? event.registration_available
			: event.registration_open && !eventStarted;
		registrationMeta.textContent = canRegister
			? `Registration open · Up to ${event.max_participants_per_registration} attendee${event.max_participants_per_registration === 1 ? "" : "s"} per household`
			: "Registration closed";
		body.appendChild(registrationMeta);

		const actions = createElement("ul", "actions");
		const actionItem = createElement("li");

		if (canRegister && canRegisterForHouseholdEvent(session)) {
			const destination = `register.html?event=${encodeURIComponent(event.id)}`;
			const registerLink = createElement("a", "button primary", "Register");
			registerLink.href = destination;
			actionItem.appendChild(registerLink);
		} else {
			const closedButton = createElement(
				"span",
				"button disabled",
				canRegister ? "Household Account Required" : "Closed"
			);
			closedButton.setAttribute("aria-disabled", "true");
			actionItem.appendChild(closedButton);
		}

		actions.appendChild(actionItem);
		if (!eventStarted) {
			const volunteerItem = createElement("li");
			const volunteerLink = createElement("a", "button", "Volunteer");
			volunteerLink.href = `volunteer-apply.html?event=${encodeURIComponent(event.id)}`;
			volunteerItem.appendChild(volunteerLink);
			actions.appendChild(volunteerItem);
		}
		const actionPanel = createElement("div", "pca-event-agenda__actions");
		actionPanel.appendChild(actions);
		card.append(date, body, actionPanel);
		return card;
	};

	const loadPublicEvents = async (lifecycle) => {
		let query = state.client
			.from("event_catalog")
			.select("id,title,description,location,starts_at,ends_at,capacity,max_participants_per_registration,registration_open,published,lifecycle,registration_available,event_date");
		query = lifecycle === "past"
			? query.eq("lifecycle", "past").order("event_date", { ascending: false }).order("ends_at", { ascending: false, nullsFirst: false })
			: query.in("lifecycle", ["upcoming", "in_progress"]).order("starts_at", { ascending: true });
		const result = await query;
		if (!result.error) return result;
		if (!/event_catalog|schema cache|relation/i.test(result.error.message || "")) return result;

		let fallback = state.client
			.from("events")
			.select("id,title,description,location,starts_at,ends_at,capacity,max_participants_per_registration,registration_open,published,event_date");
		const now = new Date();
		const easternToday = new Intl.DateTimeFormat("en-CA", {
			timeZone: APP_TIME_ZONE,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(now);
		fallback = lifecycle === "past"
			? fallback.or(`ends_at.lt.${now.toISOString()},and(starts_at.is.null,event_date.lte.${easternToday})`).order("event_date", { ascending: false }).order("ends_at", { ascending: false, nullsFirst: false })
			: fallback.or(`ends_at.gte.${now.toISOString()},and(starts_at.is.null,event_date.gt.${easternToday})`).order("starts_at", { ascending: true });
		const fallbackResult = await fallback;
		return {
			...fallbackResult,
			data: (fallbackResult.data || []).map((event) => ({
				...event,
				lifecycle: event.starts_at
					? (new Date(event.ends_at) < now ? "past" : new Date(event.starts_at) <= now ? "in_progress" : "upcoming")
					: event.event_date <= easternToday ? "past" : "upcoming",
				registration_available: Boolean(event.registration_open && event.starts_at && new Date(event.starts_at) > now),
			})),
		};
	};

	const initializeUpcomingEventsPage = async () => {
		const eventList = document.querySelector("[data-events-list]");

		if (!eventList) {
			return;
		}

		const status = document.querySelector("[data-events-status]");
		setStatus(status, "Loading upcoming events...", "info");

		const { data: events, error } = await loadPublicEvents("upcoming");

		if (error) {
			setStatus(status, "Upcoming events could not be loaded. Please try again later.", "error");
			return;
		}

		setStatus(status);
		eventList.replaceChildren();

		if (!events?.length) {
			const emptyState = createElement("section", "pca-empty-state pca-empty-state--events");
			emptyState.setAttribute("aria-labelledby", "upcoming-empty-title");
			const eyebrow = createElement("p", "eyebrow", "The next gathering is taking shape");
			const title = createElement("h2", "", "No events are open for registration right now");
			title.id = "upcoming-empty-title";
			const copy = createElement("p", "", "New programs will appear here as soon as PCA publishes them. In the meantime, explore recent events or learn how to volunteer.");
			const actions = createElement("div", "actions");
			const archiveLink = createElement("a", "button primary", "Explore past events");
			archiveLink.href = "past-events.html";
			const volunteerLink = createElement("a", "button", "Volunteer with PCA");
			volunteerLink.href = "volunteer.html";
			actions.append(archiveLink, volunteerLink);
			emptyState.append(eyebrow, title, copy, actions);
			eventList.appendChild(emptyState);
			return;
		}

		events.forEach((event) => eventList.appendChild(createEventCard(event, state.session)));
	};

	const createPastEventCard = (event) => {
		const card = createElement("article", "pca-archive-entry");
		const toggle = createElement("button", "pca-archive-entry__toggle");
		toggle.type = "button";
		toggle.setAttribute("aria-expanded", "false");
		const icon = createElement("span", "icon solid fa-plus");
		icon.setAttribute("aria-hidden", "true");
		toggle.append(createElement("span", "", event.title), icon);
		const body = createElement("div", "pca-archive-entry__body");
		body.hidden = true;
		const dateText = event.event_date
			? formatDateOnly(event.event_date)
			: event.starts_at
				? eventDateFormatter.format(new Date(event.starts_at))
				: "";
		if (dateText) {
			const date = createElement("time", "pca-event-agenda__kicker", dateText);
			date.dateTime = event.event_date || event.starts_at;
			body.appendChild(date);
		}
		const meta = [event.starts_at && event.ends_at ? formatEventRange(event) : "", event.location || ""].filter(Boolean).join(" · ");
		if (meta) body.appendChild(createElement("p", "pca-event-agenda__meta", meta));
		if (event.description) body.appendChild(createElement("p", "", event.description));
		card.append(toggle, body);
		toggle.addEventListener("click", () => {
			const open = toggle.getAttribute("aria-expanded") !== "true";
			toggle.setAttribute("aria-expanded", String(open));
			body.hidden = !open;
		});
		return card;
	};

	const initializePastEventsPage = async () => {
		const eventList = document.querySelector("[data-past-events-list]");
		if (!eventList) return;
		const status = document.querySelector("[data-past-events-status]");
		setStatus(status, "Loading completed events...", "info");
		const { data: events, error } = await loadPublicEvents("past");
		if (error) {
			setStatus(status, "Completed events could not be loaded. The historical archive is still available below.", "error");
			return;
		}
		eventList.replaceChildren();
		(events || []).forEach((event) => eventList.appendChild(createPastEventCard(event)));
		setStatus(status, events?.length ? "" : "No database events have completed yet.", "info");
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
		const accountUse = page.querySelector("[data-profile-account-use]");
		const dashboardLink = page.querySelector("[data-profile-dashboard-link]");
		const nameForm = page.querySelector("[data-profile-name-form]");
		const nameInput = nameForm.querySelector('input[name="full_name"]');
		const nameStatus = nameForm.querySelector("[data-profile-name-status]");
		const contactForm = page.querySelector("[data-profile-contact-form]");
		const contactEmailInput = contactForm.querySelector('input[name="contact_email"]');
		const contactPhoneInput = contactForm.querySelector('input[name="contact_phone"]');
		const contactStatus = contactForm.querySelector("[data-profile-contact-status]");
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
			accountUse.textContent = profile.account_use === "volunteer" ? "Volunteer Account" : "Household";
			dashboardLink.href = profile.account_use === "volunteer" ? "volunteer-dashboard.html" : "dashboard.html";
			dashboardLink.textContent = profile.account_use === "volunteer" ? "Volunteer Dashboard" : "Household Dashboard";
			nameInput.value = profile.full_name;
			contactEmailInput.value = profile.contact_email || profile.email || "";
			contactPhoneInput.value = profile.contact_phone || "";
			emailInput.value = "";
			emailInput.placeholder = profile.email;
		};

		const { data: profile, error: profileError } = await state.client
			.from("profiles")
			.select("full_name,email,contact_email,contact_phone,account_use,created_at,updated_at")
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
				setStatus(nameStatus, "Enter an account holder name between 1 and 120 characters.", "error");
				return;
			}

			if (fullName === currentProfile.full_name) {
				setStatus(nameStatus, "Your account holder name is already up to date.", "info");
				return;
			}

			setFormBusy(nameForm, true, "Saving Name...");
			const { data: updatedProfile, error } = await state.client
				.from("profiles")
				.update({ full_name: fullName })
				.eq("id", session.user.id)
				.select("full_name,email,contact_email,contact_phone,account_use,created_at,updated_at")
				.single();

			if (error || !updatedProfile) {
				console.error("Profile name update failed.", error);
				setStatus(nameStatus, "Your contact name could not be saved. Please try again.", "error");
				setFormBusy(nameForm, false);
				return;
			}

			renderProfile(updatedProfile);
			setStatus(nameStatus, "Your account holder name was updated.", "success");
			setFormBusy(nameForm, false);
		});

		contactForm.addEventListener("submit", async (event) => {
			event.preventDefault();
			setStatus(contactStatus);

			if (!contactForm.reportValidity()) {
				return;
			}

			const contactEmail = contactEmailInput.value.trim().toLowerCase();
			const contactPhone = contactPhoneInput.value.trim();

			if (contactPhone.length < 7 || contactPhone.length > 40) {
				setStatus(contactStatus, "Enter a contact phone number between 7 and 40 characters.", "error");
				contactPhoneInput.focus();
				return;
			}

			if (contactEmail === (currentProfile.contact_email || currentProfile.email || "").toLowerCase()
				&& contactPhone === (currentProfile.contact_phone || "")) {
				setStatus(contactStatus, "Your registration contact details are already up to date.", "info");
				return;
			}

			setFormBusy(contactForm, true, "Saving Contact...");
			const { data: updatedProfile, error } = await state.client
				.from("profiles")
				.update({ contact_email: contactEmail, contact_phone: contactPhone })
				.eq("id", session.user.id)
				.select("full_name,email,contact_email,contact_phone,account_use,created_at,updated_at")
				.single();

			if (error || !updatedProfile) {
				console.error("Registration contact update failed.", error);
				setStatus(contactStatus, "Your registration contact details could not be saved. Please try again.", "error");
				setFormBusy(contactForm, false);
				return;
			}

			renderProfile(updatedProfile);
			setStatus(contactStatus, "Registration contact details saved.", "success");
			setFormBusy(contactForm, false);
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
			setStatus(passwordStatus, "Verifying your current password...", "info");
			const { data: signInData, error: passwordError } = await state.client.auth.signInWithPassword({
				email: session.user.email || currentProfile.email,
				password: currentPassword,
			});

			if (passwordError || signInData.user?.id !== session.user.id) {
				setStatus(
					passwordStatus,
					String(passwordError?.message || "").toLowerCase().includes("invalid login credentials")
						? "The current password is incorrect. Your password was not changed."
						: friendlyAuthError(passwordError, "Your current password could not be verified. Your password was not changed."),
					"error"
				);
				passwordForm.querySelector('input[name="current_password"]').value = "";
				passwordForm.querySelector('input[name="current_password"]').focus();
				setFormBusy(passwordForm, false);
				return;
			}

			setStatus(passwordStatus, "Current password verified. Updating your password...", "info");
			const { error } = await state.client.auth.updateUser(passwordUpdatePayload(password, currentPassword));

			if (error) {
				setStatus(passwordStatus, friendlyAuthError(error, "Your password could not be updated. Please try again."), "error");
				passwordForm.querySelector('input[name="current_password"]').value = "";
				setFormBusy(passwordForm, false);
				return;
			}

			passwordForm.reset();
			setStatus(passwordStatus, "Your password was updated.", "success");
			setFormBusy(passwordForm, false);
		});
	};

	const showBackendFailure = (error) => {
		console.error("PCA backend initialization failed.", error);
		document.querySelectorAll("[data-backend-status]").forEach((element) => {
			setStatus(element, "The PCA account service is temporarily unavailable. Please refresh or try again later.", "error");
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
			if (!session) state.volunteerSubmissionNotified = false;

			if (authEvent === "PASSWORD_RECOVERY") {
				state.passwordRecovery = true;
				window.dispatchEvent(new CustomEvent("pca:password-recovery"));
			}

			window.setTimeout(async () => {
				try {
					await loadAccountUse(session);
					void notifyVolunteerApplication(session);
					await syncNavigation(session);
				} catch (error) {
					console.error("Account navigation could not be refreshed.", error);
				}
			}, 0);
		});

		await getSession();
		await loadAccountUse(state.session);
		void notifyVolunteerApplication(state.session);
		await syncNavigation(state.session);

		window.PCA = {
			supabase: state.client,
			getSession,
			checkAdmin,
			getAccountUse: () => state.accountUse,
			getAccountContext: async () => {
				const { data, error } = await state.client.rpc("get_account_context");
				if (error) throw error;
				return data || {};
			},
		};

		await Promise.all([
			initializeLoginPage(),
			initializePasswordRecoveryPage(),
			initializeUpcomingEventsPage(),
			initializePastEventsPage(),
			initializeProfilePage(),
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
