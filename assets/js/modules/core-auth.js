const APP_TIME_ZONE = "America/New_York";

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
	dateStyle: "long",
	timeStyle: "short",
	timeZone: APP_TIME_ZONE,
});

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeZone: APP_TIME_ZONE,
});

export const createElement = (tagName, className = "", text = "") => {
	const element = document.createElement(tagName);
	if (className) element.className = className;
	if (text) element.textContent = text;
	return element;
};

export const setStatus = (element, message = "", kind = "") => {
	if (!element) return;
	element.textContent = message;
	element.classList.remove("is-error", "is-success", "is-info");
	if (kind) element.classList.add(`is-${kind}`);
};

export const setFormBusy = (form, busy, label = "Working...") => {
	if (!form) return;
	form.setAttribute("aria-busy", String(busy));
	const submit = form.querySelector('button[type="submit"], input[type="submit"]');
	if (!submit) return;
	if (busy) {
		submit.dataset.originalLabel = submit instanceof HTMLInputElement ? submit.value : submit.textContent;
		if (submit instanceof HTMLInputElement) submit.value = label;
		else submit.textContent = label;
	} else if (submit.dataset.originalLabel) {
		if (submit instanceof HTMLInputElement) submit.value = submit.dataset.originalLabel;
		else submit.textContent = submit.dataset.originalLabel;
	}
	submit.disabled = busy;
};

export const formatEventRange = (event) => {
	const start = new Date(event.starts_at);
	const end = new Date(event.ends_at);
	return typeof dateTimeFormatter.formatRange === "function"
		? dateTimeFormatter.formatRange(start, end)
		: `${dateTimeFormatter.format(start)} – ${dateTimeFormatter.format(end)}`;
};

export const formatShortDate = (value) => shortDateFormatter.format(new Date(value));

export const platformReady = () => {
	if (window.PCA?.supabase) return Promise.resolve(window.PCA);
	return new Promise((resolve, reject) => {
		const timeout = window.setTimeout(() => reject(new Error("PCA account services did not finish loading.")), 15000);
		document.addEventListener("pca:backend-ready", () => {
			window.clearTimeout(timeout);
			resolve(window.PCA);
		}, { once: true });
	});
};

export const getSession = async () => {
	const pca = await platformReady();
	return pca.getSession();
};

export const getAccountContext = async () => {
	const pca = await platformReady();
	const { data, error } = await pca.supabase.rpc("get_account_context");
	if (error) throw error;
	return data || {};
};

export const requirePermanentAccount = async (destination = window.location.href) => {
	const session = await getSession();
	if (!session) {
		window.location.replace(`login.html?next=${encodeURIComponent(destination.split("/").pop())}`);
		return null;
	}
	const context = await getAccountContext();
	if (!context.profile) {
		window.location.replace("login.html");
		return null;
	}
	return { session, context };
};

export const syncPlatformNavigation = async () => {
	const session = await getSession();
	if (!session) return;
	const context = await getAccountContext();
	if (context.is_anonymous || !context.profile) return;
	const destination = context.profile?.account_type === "teen_member"
		? "teen-member-dashboard.html"
		: "dashboard.html";
	document.querySelectorAll("[data-pca-account-link]").forEach((link) => {
		link.href = destination;
		link.textContent = "Account";
	});
	window.PCA.accountContext = context;
};

export const friendlyError = (error, fallback = "Something went wrong. Please try again.") => {
	const message = String(error?.message || "").trim();
	if (!message) return fallback;
	if (/row-level security|permission denied|42501/i.test(message)) return "You do not have permission to complete that action.";
	if (/duplicate|23505/i.test(message)) return "That record already exists.";
	return message;
};

export const currentEventId = () => new URLSearchParams(window.location.search).get("event");

export const normalizeAttendee = (row) => ({
	full_name: row.querySelector('[name="attendee_name"]')?.value.trim() || "",
	attendee_type: row.querySelector('[name="attendee_type"]')?.value || "",
	age: row.querySelector('[name="attendee_age"]')?.value || "",
	school_district: row.querySelector('[name="attendee_school"]')?.value.trim() || "",
	household_member_id: row.dataset.householdMemberId || null,
});
