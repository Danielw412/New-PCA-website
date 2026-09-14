import {
	createElement,
	formatShortDate,
	friendlyError,
	getAccountContext,
	getSession,
	platformReady,
	setFormBusy,
	setStatus,
} from "./core-auth.js?v=20260914-guest-first-v1";
import { referralLabels } from "./events-registration.js?v=20260914-guest-first-v1";

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

const tableCell = (text, className = "") => createElement("td", className, text == null ? "" : String(text));

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
		: "";

const registrationDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeStyle: "short",
	timeZone: "America/New_York",
});

const eventTimeFormatter = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeStyle: "short",
	timeZone: "America/New_York",
});

const registrationStatusLabels = { confirmed: "Confirmed", waitlisted: "On waitlist", cancelled: "Cancelled" };
const attendeeTypeLabels = { child: "Child / Youth", adult: "Adult" };
const reviewStatusLabels = { pending: "Awaiting review", approved: "Approved", rejected: "Not approved", assigned: "Assigned", completed: "Completed", cancelled: "Cancelled", submitted: "Awaiting review" };
const formatRegistrationTime = (value) => value ? `${registrationDateTimeFormatter.format(new Date(value))} ET` : "";

export const registrationDetailFields = (registration, profile = null) => {
	const referral = registration.referral_source === "other"
		? `Other: ${registration.referral_source_other || "not specified"}`
		: referralLabels[registration.referral_source] || registration.referral_source;
	const fields = [
		["Primary contact", registration.contact_name],
		["Contact email", registration.contact_email],
		["Contact phone", registration.contact_phone],
		["Signup type", registration.registration_source === "guest" ? "Guest signup" : "Household account"],
		["PCA account", profile ? `${profile.full_name} (${profile.email})` : "No permanent account"],
		["Registration status", registrationStatusLabels[registration.status] || registration.status],
		["Attendee count", registration.participant_count],
		["Heard about PCA from", referral],
		["Future event emails", registration.future_event_emails ? "Yes" : "No"],
		["Registered", formatRegistrationTime(registration.created_at)],
		["Last updated", formatRegistrationTime(registration.updated_at)],
	];
	if (registration.cancelled_at) fields.push(["Cancelled", formatRegistrationTime(registration.cancelled_at)]);
	fields.push(["Registration ID", registration.id]);
	return fields.map(([label, value]) => [label, value == null || value === "" ? "Not provided" : String(value)]);
};

export const attendeeDetailValues = (attendee, includeGrade = false) => [
	attendee.position,
	attendee.full_name,
	attendeeTypeLabels[attendee.attendee_type] || attendee.attendee_type,
	attendee.age,
	attendee.school_district,
	...(includeGrade ? [attendee.grade] : []),
];

export const attendeeInlineSummary = (attendee) => {
	const name = String(attendee?.full_name || "").trim() || "Attendee";
	if (attendee?.attendee_type === "child") {
		const details = [attendee.age != null && attendee.age !== "" ? `age ${attendee.age}` : "", attendee.school_district || ""].filter(Boolean);
		return details.length ? `${name} (${details.join(", ")})` : name;
	}
	if (attendee?.attendee_type === "adult") return `${name} (adult)`;
	if (attendee?.grade) return `${name} (grade ${attendee.grade})`;
	return name;
};

// Summaries for the event rail: seats confirmed, groups waiting, and whether
// registration is still open for new groups.
export const summarizeEventRegistrations = (event, registrations, now = new Date()) => {
	const rows = registrations.filter((registration) => registration.event_id === event.id);
	const confirmed = rows.filter((registration) => registration.status === "confirmed");
	const waitlisted = rows.filter((registration) => registration.status === "waitlisted");
	const cancelled = rows.filter((registration) => registration.status === "cancelled");
	const confirmedSeats = confirmed.reduce((total, registration) => total + Number(registration.participant_count || 0), 0);
	const waitlistedSeats = waitlisted.reduce((total, registration) => total + Number(registration.participant_count || 0), 0);
	const startsAt = event.starts_at ? new Date(event.starts_at) : null;
	const endsAt = event.ends_at ? new Date(event.ends_at) : null;
	const upcoming = Boolean(startsAt && startsAt > now) || (!startsAt && Boolean(event.event_date) && event.event_date >= easternCalendarDateFormatter.format(now));
	return {
		eventId: event.id,
		title: event.title,
		upcoming,
		inProgress: Boolean(startsAt && endsAt && startsAt <= now && endsAt >= now),
		deleted: Boolean(event.deleted_at),
		capacity: Number(event.capacity || 0),
		confirmedGroups: confirmed.length,
		confirmedSeats,
		waitlistedGroups: waitlisted.length,
		waitlistedSeats,
		cancelledGroups: cancelled.length,
		totalGroups: rows.length,
	};
};

const csvCell = (value) => {
	const rawValue = String(value ?? "");
	const spreadsheetSafeValue = /^[=+\-@\t\r]/.test(rawValue) ? `'${rawValue}` : rawValue;
	return `"${spreadsheetSafeValue.replace(/"/g, '""')}"`;
};

const downloadCsv = (rows, filename) => {
	const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
	const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
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
	return event.registration_open ? "Upcoming" : "Upcoming, registration closed";
};

// --- Shared feedback: a modal confirm and a toast region -------------------
// Native window.confirm/prompt/alert block the page and cannot be styled, so
// the workspace uses one <dialog> for decisions and a live region for results.

const dialogElement = () => {
	let dialog = document.querySelector("[data-admin-dialog]");
	if (dialog) return dialog;
	dialog = createElement("dialog", "pca-dialog");
	dialog.dataset.adminDialog = "true";
	const form = createElement("form");
	form.method = "dialog";
	form.append(
		createElement("h2", "", ""),
		createElement("p", "", ""),
		createElement("div", "pca-dialog__actions")
	);
	dialog.appendChild(form);
	document.body.appendChild(dialog);
	return dialog;
};

const confirmDialog = ({ title, message, confirmLabel = "Confirm", cancelLabel = "Keep", danger = false }) => new Promise((resolve) => {
	const dialog = dialogElement();
	dialog.querySelector("h2").textContent = title;
	dialog.querySelector("p").textContent = message;
	const actions = dialog.querySelector(".pca-dialog__actions");
	actions.replaceChildren();
	const cancel = createElement("button", "button", cancelLabel);
	cancel.type = "button";
	cancel.addEventListener("click", () => dialog.close("cancel"));
	const confirm = createElement("button", `button primary${danger ? " pca-button-danger" : ""}`, confirmLabel);
	confirm.type = "button";
	confirm.addEventListener("click", () => dialog.close("confirm"));
	actions.append(cancel, confirm);
	dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
	dialog.returnValue = "";
	dialog.showModal();
	cancel.focus();
});

const toast = (message, kind = "success") => {
	const region = document.querySelector("[data-admin-toast]");
	if (!region) return;
	const item = createElement("p", `pca-admin-toast is-${kind}`, message);
	region.appendChild(item);
	window.setTimeout(() => item.classList.add("is-leaving"), 4600);
	window.setTimeout(() => item.remove(), 5200);
};

// A decision (approve or reject) collects an optional note inline instead of
// through a prompt box, and confirms in place.
const createDecisionForm = ({ decision, label, notesLabel, notesValue = "", onConfirm, onCancel }) => {
	const form = createElement("form", `pca-admin-decision is-${decision}`);
	const field = createElement("div", "field");
	const id = `admin-decision-${Math.random().toString(36).slice(2, 9)}`;
	const notesElement = createElement("label", "", notesLabel);
	notesElement.htmlFor = id;
	const notes = createElement("textarea");
	notes.id = id;
	notes.rows = 2;
	notes.maxLength = 4000;
	notes.value = notesValue;
	field.append(notesElement, notes);
	const actions = createElement("div", "pca-admin-decision__actions");
	const confirm = createElement("button", `button small${decision === "approved" ? " primary" : ""}`, label);
	confirm.type = "submit";
	const cancel = createElement("button", "button small", "Back");
	cancel.type = "button";
	cancel.addEventListener("click", () => onCancel());
	actions.append(confirm, cancel);
	form.append(field, actions);
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		setFormBusy(form, true, "Saving...");
		try {
			await onConfirm(notes.value.trim());
		} catch (error) {
			setFormBusy(form, false);
			toast(friendlyError(error, "The decision could not be saved."), "error");
		}
	});
	return form;
};

const makeBadge = (status, labels = reviewStatusLabels) => createElement("span", `pca-status-badge is-${status}`, labels[status] || status);

const makeMetaLine = (parts) => {
	const line = createElement("p", "pca-admin-record__meta");
	parts.filter(Boolean).forEach((part) => line.appendChild(createElement("span", "", part)));
	return line;
};

const makeMailLink = (email) => {
	const link = createElement("a", "", email);
	link.href = `mailto:${email}`;
	return link;
};

// The workspace panels are all static markup now. Earlier builds assembled
// the volunteers panel at runtime; keep the export so the platform loader
// can still call it.
export const prepareAdministrationShell = () => {};

const initializeWorkspaceTabs = (page) => {
	const tabs = [...page.querySelectorAll("[data-admin-tab]")];
	const panels = [...page.querySelectorAll("[data-admin-panel]")];
	const show = (name, focusTab = false) => {
		const selectedName = tabs.some((tab) => tab.dataset.adminTab === name) ? name : "overview";
		tabs.forEach((tab) => {
			const active = tab.dataset.adminTab === selectedName;
			tab.classList.toggle("primary", active);
			tab.classList.toggle("is-selected", active);
			tab.setAttribute("aria-selected", String(active));
			tab.tabIndex = active ? 0 : -1;
			if (active && focusTab) tab.focus();
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
			show(tabs[nextIndex].dataset.adminTab, true);
		});
	});
	page.querySelectorAll("[data-admin-tab-link]").forEach((link) => {
		link.addEventListener("click", () => show(link.dataset.adminTabLink, true));
	});
	show(window.location.hash.slice(1) || "overview");
	return show;
};

// --- Overview ---------------------------------------------------------------

const loadOverview = async (page, supabase) => {
	const setCount = (hook, value) => {
		const target = page.querySelector(`[data-admin-count="${hook}"]`);
		if (target) target.textContent = value == null ? "?" : String(value);
	};
	const nowIso = new Date().toISOString();
	const [eventsResult, registrationsResult, householdsResult, applicationsResult, requestsResult] = await Promise.all([
		supabase.from("events").select("id,starts_at,event_date,published").is("deleted_at", null).eq("published", true).gt("starts_at", nowIso),
		supabase.from("event_registrations").select("event_id,status,participant_count").neq("status", "cancelled"),
		supabase.from("account_profiles").select("id", { count: "exact", head: true }).eq("account_type", "household"),
		supabase.from("volunteer_applications").select("id", { count: "exact", head: true }).eq("status", "pending"),
		supabase.from("event_volunteer_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
	]);
	const upcomingIds = new Set((eventsResult.data || []).map((event) => event.id));
	const registrations = registrationsResult.data || [];
	setCount("upcoming-events", eventsResult.error ? null : upcomingIds.size);
	setCount("upcoming-attendees", registrationsResult.error ? null : registrations
		.filter((registration) => registration.status === "confirmed" && upcomingIds.has(registration.event_id))
		.reduce((total, registration) => total + Number(registration.participant_count || 0), 0));
	setCount("waitlisted", registrationsResult.error ? null : registrations.filter((registration) => registration.status === "waitlisted" && upcomingIds.has(registration.event_id)).length);
	setCount("households", householdsResult.error ? null : householdsResult.count ?? 0);
	setCount("volunteer-applications", applicationsResult.error ? null : applicationsResult.count ?? 0);
	setCount("volunteer-requests", requestsResult.error ? null : requestsResult.count ?? 0);
};

const loadEmailHealth = async (page, supabase, { retry = false } = {}) => {
	const panel = page.querySelector("[data-admin-email-health]");
	if (!panel) return;
	const copy = panel.querySelector("[data-admin-email-health-copy]");
	const retryButton = panel.querySelector("[data-admin-email-retry]");
	panel.dataset.state = "loading";
	const [summaryResult, retryResult] = await Promise.all([
		supabase.rpc("admin_email_queue_summary"),
		retry ? supabase.functions.invoke("pca-transactional-email", { body: { retry_queued: true } }) : Promise.resolve(null),
	]);
	const summary = summaryResult.error ? null : summaryResult.data;
	const waiting = summary ? Number(summary.queued || 0) + Number(summary.failed || 0) : null;
	const configured = retryResult && !retryResult.error ? retryResult.data?.configured !== false : null;
	const sentNow = retryResult && !retryResult.error ? Number(retryResult.data?.sent || 0) : 0;

	let message;
	if (summaryResult.error) {
		message = "The email queue could not be read.";
		panel.dataset.state = "error";
	} else if (configured === false) {
		message = `Email delivery is not configured, so nothing is being sent. ${waiting} message${waiting === 1 ? "" : "s"} ${waiting === 1 ? "is" : "are"} waiting, including registration confirmations and volunteer request alerts.`;
		panel.dataset.state = "unconfigured";
	} else if (waiting > 0) {
		message = `${waiting} message${waiting === 1 ? "" : "s"} waiting to send.${summary.last_error ? ` Last error: ${summary.last_error}` : ""}${sentNow ? ` Sent ${sentNow} just now.` : ""}`;
		panel.dataset.state = "waiting";
	} else {
		message = `All caught up. ${summary.sent || 0} message${Number(summary.sent) === 1 ? "" : "s"} sent${summary.last_sent_at ? `, most recently ${formatRegistrationTime(summary.last_sent_at)}` : ""}.`;
		panel.dataset.state = "healthy";
	}
	copy.textContent = message;
	if (retryButton) {
		retryButton.hidden = !(waiting > 0);
		retryButton.disabled = false;
		retryButton.textContent = "Retry Waiting Emails";
	}
};

// --- Events -----------------------------------------------------------------

const loadEvents = async (page, supabase, showTab) => {
	const table = page.querySelector("[data-admin-events-body]");
	const [eventsResult, registrationsResult] = await Promise.all([
		supabase.from("events").select("*").is("deleted_at", null).order("event_date", { ascending: false }).order("starts_at", { ascending: false, nullsFirst: false }),
		supabase.from("event_registrations").select("event_id,status,participant_count"),
	]);
	if (eventsResult.error) throw eventsResult.error;
	const registrations = registrationsResult.data || [];
	table.replaceChildren();
	(eventsResult.data || []).forEach((event) => {
		const summary = summarizeEventRegistrations(event, registrations);
		const row = createElement("tr");
		const titleCell = createElement("td");
		titleCell.append(createElement("strong", "", event.title));
		if (event.location) titleCell.append(createElement("span", "pca-table-subtext", event.location));
		const registeredCell = createElement("td");
		if (summary.totalGroups) {
			const open = createElement("button", "pca-link-button", `${summary.confirmedSeats} of ${summary.capacity} seats`);
			open.type = "button";
			open.addEventListener("click", () => {
				registrationsState.selectedEventId = event.id;
				showTab("registrations", true);
				void renderRoster(page, supabase);
			});
			registeredCell.appendChild(open);
			if (summary.waitlistedGroups) registeredCell.appendChild(createElement("span", "pca-table-subtext", `${summary.waitlistedGroups} group${summary.waitlistedGroups === 1 ? "" : "s"} waiting`));
		} else {
			registeredCell.textContent = event.published && event.registration_open ? "No registrations yet" : "—";
		}
		const actions = createElement("td", "pca-admin-row-actions");
		const edit = createElement("button", "button small", "Edit");
		edit.type = "button";
		edit.addEventListener("click", () => openEventEditor(page, event));
		const remove = createElement("button", "button small pca-button-danger", "Delete");
		remove.type = "button";
		remove.addEventListener("click", async () => {
			const confirmed = await confirmDialog({
				title: `Delete "${event.title}"?`,
				message: "The event disappears from the website. Existing registrations and volunteer records are kept for your records.",
				confirmLabel: "Delete event",
				cancelLabel: "Keep event",
				danger: true,
			});
			if (!confirmed) return;
			remove.disabled = true;
			const { error: deleteError } = await supabase.rpc("delete_event", { p_event_id: event.id });
			if (deleteError) {
				remove.disabled = false;
				toast(friendlyError(deleteError, "The event could not be deleted."), "error");
				return;
			}
			toast(`${event.title} was deleted.`);
			await Promise.all([loadEvents(page, supabase, showTab), loadOverview(page, supabase), loadRegistrations(page, supabase)]);
		});
		actions.append(edit, remove);
		row.append(titleCell, tableCell(eventDateTableValue(event)), registeredCell, tableCell(eventStateLabel(event)), actions);
		table.appendChild(row);
	});
	if (!eventsResult.data?.length) {
		const row = createElement("tr");
		const empty = createElement("td", "pca-admin-empty", "No events yet. Create the first one above.");
		empty.colSpan = 5;
		row.appendChild(empty);
		table.appendChild(row);
	}
};

const openEventEditor = (page, event = null) => {
	const editor = page.querySelector("[data-admin-event-editor]");
	const form = page.querySelector("[data-admin-event-form]");
	const title = page.querySelector("[data-admin-event-editor-title]");
	form.reset();
	form.elements.event_id.value = event?.id || "";
	if (title) title.textContent = event ? `Edit ${event.title}` : "Create an event";
	if (event) {
		form.elements.title.value = event.title;
		form.elements.description.value = event.description || "";
		form.elements.location.value = event.location || "";
		form.elements.event_date.value = eventDateInputValue(event);
		const localValue = (iso) => iso ? new Intl.DateTimeFormat("sv-SE", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(" ", "T") : "";
		form.elements.starts_at.value = localValue(event.starts_at);
		form.elements.ends_at.value = localValue(event.ends_at);
		form.elements.capacity.value = event.capacity;
		form.elements.max_participants_per_registration.value = event.max_participants_per_registration;
		form.elements.registration_open.checked = event.registration_open;
		form.elements.published.checked = event.published;
	}
	setStatus(page.querySelector("[data-admin-event-status]"));
	editor.open = true;
	editor.scrollIntoView({ behavior: "smooth", block: "start" });
	form.elements.title.focus();
};

const initializeEventForm = (page, supabase, showTab) => {
	const form = page.querySelector("[data-admin-event-form]");
	const editor = page.querySelector("[data-admin-event-editor]");
	const status = page.querySelector("[data-admin-event-status]");
	page.querySelector("[data-admin-event-new]")?.addEventListener("click", () => openEventEditor(page));
	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		const values = new FormData(form);
		let payload;
		try {
			const startsAt = String(values.get("starts_at") || "").trim();
			const endsAt = String(values.get("ends_at") || "").trim();
			if ((startsAt && !endsAt) || (!startsAt && endsAt)) throw new Error("Enter both start and end times, or leave both blank.");
			if (values.has("registration_open") && !startsAt) throw new Error("Add a start time before opening registration.");
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
			if (payload.max_participants_per_registration > payload.capacity) throw new Error("The maximum per registration cannot exceed the event capacity.");
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
		const wasEdit = Boolean(values.get("event_id"));
		form.reset();
		form.elements.event_id.value = "";
		editor.open = false;
		toast(wasEdit ? "Event updated." : `${payload.title} was created${payload.published ? " and published" : " as a draft"}.`);
		await Promise.all([loadEvents(page, supabase, showTab), loadOverview(page, supabase), loadRegistrations(page, supabase)]);
		void supabase.functions.invoke("pca-transactional-email", { body: { retry_promotions: true } })
			.then(({ error: promotionError }) => {
				if (promotionError) console.debug("Waitlist promotion email remains queued.", promotionError);
			});
	});
	page.querySelector("[data-admin-event-clear]").addEventListener("click", () => {
		form.reset();
		form.elements.event_id.value = "";
		editor.open = false;
		setStatus(status);
	});
};

// --- Registrations ----------------------------------------------------------
// Event first: the rail lists events with their seat counts, and the roster
// shows every group for the chosen event with attendees inline, so nothing
// needs a second click to answer "who is coming?".

const registrationsState = {
	events: [],
	registrations: [],
	profiles: new Map(),
	summaries: [],
	selectedEventId: null,
	attendeesByRegistration: new Map(),
	loadedEventId: null,
	search: "",
	showCancelled: false,
};

const rosterSelectionKey = "pcaAdminRosterEvent";

const loadRegistrations = async (page, supabase) => {
	const [registrationResult, eventsResult, profilesResult] = await Promise.all([
		supabase.from("event_registrations").select("*").order("created_at", { ascending: false }),
		supabase.from("events").select("id,title,location,starts_at,ends_at,event_date,capacity,max_participants_per_registration,registration_open,published,deleted_at"),
		supabase.from("account_profiles").select("id,full_name,email"),
	]);
	for (const result of [registrationResult, eventsResult, profilesResult]) if (result.error) throw result.error;
	registrationsState.registrations = registrationResult.data || [];
	registrationsState.events = eventsResult.data || [];
	registrationsState.profiles = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
	registrationsState.loadedEventId = null;

	const now = new Date();
	const withRegistrations = new Set(registrationsState.registrations.map((registration) => registration.event_id));
	registrationsState.summaries = registrationsState.events
		.filter((event) => withRegistrations.has(event.id) || (!event.deleted_at && event.published && event.starts_at && new Date(event.starts_at) > now))
		.map((event) => ({ ...summarizeEventRegistrations(event, registrationsState.registrations, now), event }))
		.sort((a, b) => {
			if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
			const aTime = new Date(a.event.starts_at || `${a.event.event_date || "1970-01-01"}T12:00:00Z`).getTime();
			const bTime = new Date(b.event.starts_at || `${b.event.event_date || "1970-01-01"}T12:00:00Z`).getTime();
			return a.upcoming ? aTime - bTime : bTime - aTime;
		});

	const remembered = registrationsState.selectedEventId || sessionStorage.getItem(rosterSelectionKey);
	const stillListed = registrationsState.summaries.some((summary) => summary.eventId === remembered);
	registrationsState.selectedEventId = stillListed
		? remembered
		: (registrationsState.summaries.find((summary) => summary.upcoming && summary.totalGroups) || registrationsState.summaries[0])?.eventId || null;
	renderEventRail(page, supabase);
	await renderRoster(page, supabase);
};

const renderEventRail = (page, supabase) => {
	const rail = page.querySelector("[data-admin-event-rail]");
	rail.replaceChildren();
	if (!registrationsState.summaries.length) {
		rail.appendChild(createElement("p", "pca-admin-event-rail__empty", "No events have registrations yet."));
		return;
	}
	let lastGroup = null;
	registrationsState.summaries.forEach((summary) => {
		const group = summary.upcoming ? "Upcoming" : "Past";
		if (group !== lastGroup) {
			rail.appendChild(createElement("span", "pca-admin-event-rail__group", group));
			lastGroup = group;
		}
		const button = createElement("button", "pca-admin-event-rail__item");
		button.type = "button";
		button.dataset.eventId = summary.eventId;
		button.setAttribute("aria-pressed", String(summary.eventId === registrationsState.selectedEventId));
		button.append(
			createElement("strong", "", summary.title),
			createElement("span", "", eventDateTableValue(summary.event) || "Date to be announced"),
			createElement("span", `pca-admin-event-rail__count${summary.totalGroups ? "" : " is-empty"}`, summary.totalGroups
				? `${summary.confirmedSeats} of ${summary.capacity} seats${summary.waitlistedGroups ? `, ${summary.waitlistedGroups} waiting` : ""}`
				: "No registrations")
		);
		button.addEventListener("click", () => {
			registrationsState.selectedEventId = summary.eventId;
			sessionStorage.setItem(rosterSelectionKey, summary.eventId);
			rail.querySelectorAll("[data-event-id]").forEach((item) => item.setAttribute("aria-pressed", String(item.dataset.eventId === summary.eventId)));
			void renderRoster(page, supabase);
		});
		rail.appendChild(button);
	});
};

const registrationMatchesSearch = (registration, attendees, term) => {
	if (!term) return true;
	const haystack = [
		registration.contact_name,
		registration.contact_email,
		registration.contact_phone,
		...attendees.flatMap((attendee) => [attendee.full_name, attendee.school_district]),
	].filter(Boolean).join(" ").toLowerCase();
	return haystack.includes(term);
};

const renderRoster = async (page, supabase) => {
	const list = page.querySelector("[data-admin-roster-list]");
	const title = page.querySelector("[data-admin-roster-title]");
	const meta = page.querySelector("[data-admin-roster-meta]");
	const status = page.querySelector("[data-admin-roster-status]");
	const exportButton = page.querySelector("[data-admin-export]");
	const summary = registrationsState.summaries.find((item) => item.eventId === registrationsState.selectedEventId);
	page.querySelectorAll("[data-admin-event-rail] [data-event-id]").forEach((item) => item.setAttribute("aria-pressed", String(item.dataset.eventId === registrationsState.selectedEventId)));
	if (!summary) {
		title.textContent = "Choose an event";
		meta.textContent = "";
		list.replaceChildren();
		if (exportButton) exportButton.disabled = true;
		return;
	}
	title.textContent = summary.title;
	const metaParts = [
		summary.event.starts_at ? eventTimeFormatter.format(new Date(summary.event.starts_at)) : eventDateTableValue(summary.event),
		summary.event.location || "",
		`${summary.confirmedSeats} of ${summary.capacity} seats confirmed`,
		summary.waitlistedGroups ? `${summary.waitlistedGroups} group${summary.waitlistedGroups === 1 ? "" : "s"} on the waitlist` : "",
		summary.event.deleted_at ? "Deleted event" : !summary.event.registration_open ? "Registration closed" : "",
	].filter(Boolean);
	meta.replaceChildren(...metaParts.map((part) => createElement("span", "", part)));
	if (exportButton) exportButton.disabled = false;

	const registrations = registrationsState.registrations.filter((registration) => registration.event_id === summary.eventId);
	if (registrationsState.loadedEventId !== summary.eventId) {
		setStatus(status, "Loading attendees...", "info");
		const ids = registrations.map((registration) => registration.id);
		registrationsState.attendeesByRegistration = new Map();
		if (ids.length) {
			const { data: attendees, error } = await supabase
				.from("event_registration_attendees")
				.select("registration_id,position,full_name,attendee_type,age,school_district,grade")
				.in("registration_id", ids)
				.order("position");
			if (error) {
				setStatus(status, friendlyError(error, "Attendees could not be loaded."), "error");
				return;
			}
			(attendees || []).forEach((attendee) => {
				const rows = registrationsState.attendeesByRegistration.get(attendee.registration_id) || [];
				rows.push(attendee);
				registrationsState.attendeesByRegistration.set(attendee.registration_id, rows);
			});
		}
		registrationsState.loadedEventId = summary.eventId;
		setStatus(status);
	}

	const term = registrationsState.search.trim().toLowerCase();
	const visible = registrations
		.filter((registration) => registrationsState.showCancelled || registration.status !== "cancelled")
		.filter((registration) => registrationMatchesSearch(registration, registrationsState.attendeesByRegistration.get(registration.id) || [], term))
		.sort((a, b) => {
			const order = { confirmed: 0, waitlisted: 1, cancelled: 2 };
			if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
			return new Date(a.created_at) - new Date(b.created_at);
		});

	list.replaceChildren();
	if (!visible.length) {
		list.appendChild(createElement("p", "pca-empty-state", registrations.length
			? (term ? "No registrations match that search." : "Only cancelled registrations remain. Turn on Show cancelled to see them.")
			: "No one has registered for this event yet."));
		return;
	}
	visible.forEach((registration) => list.appendChild(renderRosterEntry(page, supabase, registration)));
};

const renderRosterEntry = (page, supabase, registration) => {
	const attendees = registrationsState.attendeesByRegistration.get(registration.id) || [];
	const profile = registrationsState.profiles.get(registration.owner_user_id);
	const entry = createElement("article", `pca-admin-record is-${registration.status}`);
	const main = createElement("div", "pca-admin-record__main");
	const titleRow = createElement("div", "pca-admin-record__title");
	titleRow.append(
		createElement("strong", "", registration.contact_name || profile?.full_name || "Unnamed contact"),
		makeBadge(registration.status, registrationStatusLabels),
		createElement("span", "pca-admin-record__tag", registration.registration_source === "guest" ? "Guest" : "Household")
	);
	main.appendChild(titleRow);
	const contactLine = createElement("p", "pca-admin-record__meta");
	if (registration.contact_email) contactLine.appendChild(makeMailLink(registration.contact_email));
	if (registration.contact_phone) contactLine.appendChild(createElement("span", "", registration.contact_phone));
	contactLine.appendChild(createElement("span", "", `Registered ${formatShortDate(registration.created_at)}`));
	main.appendChild(contactLine);
	const attendeeLine = createElement("p", "pca-admin-record__attendees");
	attendeeLine.appendChild(createElement("strong", "", `${attendees.length || registration.participant_count} attendee${(attendees.length || registration.participant_count) === 1 ? "" : "s"}`));
	attendeeLine.appendChild(document.createTextNode(attendees.length ? `: ${attendees.map(attendeeInlineSummary).join("; ")}` : ""));
	main.appendChild(attendeeLine);

	const actions = createElement("div", "pca-admin-record__actions");
	const details = createElement("div", "pca-admin-record__details");
	details.id = `admin-registration-${registration.id}`;
	details.hidden = true;
	const toggle = createElement("button", "button small", "Details");
	toggle.type = "button";
	toggle.setAttribute("aria-expanded", "false");
	toggle.setAttribute("aria-controls", details.id);
	toggle.addEventListener("click", () => {
		const expanded = toggle.getAttribute("aria-expanded") !== "true";
		toggle.setAttribute("aria-expanded", String(expanded));
		toggle.textContent = expanded ? "Hide details" : "Details";
		details.hidden = !expanded;
		if (expanded && !details.childElementCount) renderRegistrationDetails(details, registration, profile, attendees);
	});
	actions.appendChild(toggle);
	if (registration.status !== "cancelled") {
		const edit = createElement("a", "button small", "Edit attendees");
		edit.href = `register.html?event=${encodeURIComponent(registration.event_id)}&registration=${encodeURIComponent(registration.id)}`;
		actions.appendChild(edit);
		const cancel = createElement("button", "button small pca-button-danger", "Cancel registration");
		cancel.type = "button";
		cancel.addEventListener("click", async () => {
			const confirmed = await confirmDialog({
				title: `Cancel ${registration.contact_name || "this"} registration?`,
				message: registration.status === "confirmed"
					? `${registration.participant_count} seat${registration.participant_count === 1 ? "" : "s"} will be released. If groups are waiting, the next one in line is confirmed automatically and emailed.`
					: "The group will be removed from the waitlist.",
				confirmLabel: "Cancel registration",
				cancelLabel: "Keep registration",
				danger: true,
			});
			if (!confirmed) return;
			cancel.disabled = true;
			const { error } = await supabase.rpc("cancel_event_registration", { p_registration_id: registration.id });
			if (error) {
				cancel.disabled = false;
				toast(friendlyError(error, "The registration could not be cancelled."), "error");
				return;
			}
			toast("Registration cancelled.");
			void supabase.functions.invoke("pca-transactional-email", { body: { retry_promotions: true } })
				.then(({ error: promotionError }) => {
					if (promotionError) console.debug("A waitlist notification remains safely queued.", promotionError);
				});
			await Promise.all([loadRegistrations(page, supabase), loadOverview(page, supabase)]);
		});
		actions.appendChild(cancel);
	}
	entry.append(main, actions, details);
	return entry;
};

const renderRegistrationDetails = (container, registration, profile, attendees) => {
	const summary = createElement("section");
	const list = createElement("dl", "pca-admin-detail-list");
	registrationDetailFields(registration, profile).forEach(([label, value]) => {
		const item = createElement("div");
		item.append(createElement("dt", "", label), createElement("dd", "", value));
		list.appendChild(item);
	});
	summary.append(createElement("h4", "", "Registrant"), list);

	const people = createElement("section");
	people.appendChild(createElement("h4", "", "Attendees"));
	if (!attendees.length) {
		people.appendChild(createElement("p", "", "No attendees are recorded for this registration."));
	} else {
		const includeGrade = attendees.some((attendee) => attendee.grade);
		const headRow = createElement("tr");
		["#", "Name", "Type", "Age", "School / District", ...(includeGrade ? ["Grade"] : [])].forEach((label) => {
			const heading = createElement("th", "", label);
			heading.scope = "col";
			headRow.appendChild(heading);
		});
		const head = createElement("thead");
		head.appendChild(headRow);
		const rows = createElement("tbody");
		attendees.forEach((attendee) => {
			const row = createElement("tr");
			attendeeDetailValues(attendee, includeGrade).forEach((value) => row.appendChild(tableCell(value)));
			rows.appendChild(row);
		});
		const wrapper = createElement("div", "table-wrapper");
		const table = createElement("table", "pca-admin-attendee-table");
		table.append(head, rows);
		wrapper.appendChild(table);
		people.appendChild(wrapper);
	}
	container.append(summary, people);
};

const initializeRosterTools = (page, supabase) => {
	const search = page.querySelector("[data-admin-roster-search]");
	const cancelled = page.querySelector("[data-admin-roster-cancelled]");
	let searchTimer = null;
	search?.addEventListener("input", () => {
		window.clearTimeout(searchTimer);
		searchTimer = window.setTimeout(() => {
			registrationsState.search = search.value;
			void renderRoster(page, supabase);
		}, 120);
	});
	cancelled?.addEventListener("change", () => {
		registrationsState.showCancelled = cancelled.checked;
		void renderRoster(page, supabase);
	});

	const exportButton = page.querySelector("[data-admin-export]");
	const exportStatus = page.querySelector("[data-admin-export-status]");
	exportButton?.addEventListener("click", async () => {
		const summary = registrationsState.summaries.find((item) => item.eventId === registrationsState.selectedEventId);
		if (!summary) return;
		exportButton.disabled = true;
		setStatus(exportStatus, "Preparing the download...", "info");
		try {
			const registrations = registrationsState.registrations.filter((registration) => registration.event_id === summary.eventId);
			const { data: attendees, error } = await supabase
				.from("event_registration_attendees")
				.select("registration_id,position,full_name,attendee_type,age,school_district,grade")
				.in("registration_id", registrations.map((registration) => registration.id))
				.order("position");
			if (error) throw error;
			const attendeesByRegistration = new Map();
			(attendees || []).forEach((attendee) => {
				const rows = attendeesByRegistration.get(attendee.registration_id) || [];
				rows.push(attendee);
				attendeesByRegistration.set(attendee.registration_id, rows);
			});
			const headers = ["Event", "Event start (Eastern)", "Registration status", "Signup type", "Primary contact", "Contact email", "Contact phone", "Attendee", "Attendee type", "Age", "School / District", "Heard about PCA from", "Future event emails", "Registered (Eastern)", "Registration ID"];
			const rows = registrations.flatMap((registration) => {
				const people = attendeesByRegistration.get(registration.id) || [null];
				return people.map((attendee) => [
					summary.title,
					summary.event.starts_at ? eventTimeFormatter.format(new Date(summary.event.starts_at)) : eventDateTableValue(summary.event),
					registrationStatusLabels[registration.status] || registration.status,
					registration.registration_source === "guest" ? "Guest signup" : "Household account",
					registration.contact_name,
					registration.contact_email,
					registration.contact_phone,
					attendee?.full_name || "",
					attendeeTypeLabels[attendee?.attendee_type] || "",
					attendee?.age ?? "",
					attendee?.school_district || "",
					registration.referral_source === "other" ? `Other: ${registration.referral_source_other || ""}` : referralLabels[registration.referral_source] || registration.referral_source || "",
					registration.future_event_emails ? "Yes" : "No",
					formatRegistrationTime(registration.created_at),
					registration.id,
				]);
			});
			const slug = summary.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
			downloadCsv([headers, ...rows], `pca-${slug}-registrations-${new Date().toISOString().slice(0, 10)}.csv`);
			setStatus(exportStatus, `Downloaded ${rows.length} attendee row${rows.length === 1 ? "" : "s"} for ${summary.title}.`, "success");
		} catch (error) {
			console.error("Registration export failed.", error);
			setStatus(exportStatus, friendlyError(error, "The download could not be created."), "error");
		} finally {
			exportButton.disabled = false;
		}
	});
};

// --- Households -------------------------------------------------------------

const deleteManagedAccount = async (supabase, profile, reload) => {
	if (!profile?.id) return;
	const confirmed = await confirmDialog({
		title: `Delete ${profile.full_name}'s account?`,
		message: "This removes their sign-in, profile, and saved household or volunteer records. It cannot be undone.",
		confirmLabel: "Delete account",
		cancelLabel: "Keep account",
		danger: true,
	});
	if (!confirmed) return;
	const { error } = await supabase.rpc("delete_account_as_admin", { p_target_user_id: profile.id });
	if (error) {
		toast(friendlyError(error, "The account could not be deleted."), "error");
		return;
	}
	toast(`${profile.full_name}'s account was deleted.`);
	await reload();
};

const createInlineField = (labelText, name, type, value, { required = true, min, max } = {}) => {
	const field = createElement("div", "field");
	const id = `admin-inline-${name}-${Math.random().toString(36).slice(2, 8)}`;
	const label = createElement("label", "", labelText);
	label.htmlFor = id;
	const input = createElement(type === "select" ? "select" : "input");
	input.id = id;
	input.name = name;
	if (type !== "select") {
		input.type = type;
		input.value = value ?? "";
		if (min != null) input.min = String(min);
		if (max != null) input.max = String(max);
	}
	input.required = required;
	field.append(label, input);
	return { field, input };
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
		memberPanel.replaceChildren();
		const heading = createElement("div", "pca-admin-members-panel__heading");
		heading.append(createElement("h3", "", `${profile.full_name}: saved attendees`));
		const close = createElement("button", "button small", "Close");
		close.type = "button";
		close.addEventListener("click", () => { memberPanel.hidden = true; });
		heading.appendChild(close);
		memberPanel.appendChild(heading);
		const grid = createElement("div", "pca-saved-member-grid");
		if (!members?.length) grid.appendChild(createElement("p", "pca-empty-state", "No saved attendees yet."));
		(members || []).forEach((member) => {
			const card = createElement("article", "pca-card pca-saved-member-card");
			card.append(createElement("h4", "", member.full_name), createElement("p", "", member.attendee_type === "child" ? `Age ${member.age}, ${member.school_district}` : "Adult"));
			const remove = createElement("button", "button small pca-button-danger", "Remove");
			remove.type = "button";
			remove.addEventListener("click", async () => {
				const confirmed = await confirmDialog({
					title: `Remove ${member.full_name}?`,
					message: "They are removed from this household's saved attendees. Existing registrations are not changed.",
					confirmLabel: "Remove",
					danger: true,
				});
				if (!confirmed) return;
				const { error: removeError } = await supabase.from("household_members").delete().eq("id", member.id);
				if (removeError) toast(friendlyError(removeError), "error");
				else await showMembers(profile);
			});
			card.appendChild(remove);
			grid.appendChild(card);
		});
		memberPanel.appendChild(grid);

		const addForm = createElement("form", "pca-admin-inline-form");
		const fields = createElement("div", "fields");
		const name = createInlineField("Full name", "full_name", "text", "");
		name.input.maxLength = 120;
		const type = createInlineField("Attendee type", "attendee_type", "select", "");
		[["child", "Child / Youth"], ["adult", "Adult"]].forEach(([value, label]) => {
			const option = createElement("option", "", label);
			option.value = value;
			type.input.appendChild(option);
		});
		const age = createInlineField("Age", "age", "number", "", { min: 0, max: 25 });
		const school = createInlineField("School / District", "school_district", "text", "");
		school.input.maxLength = 160;
		name.field.classList.add("half");
		type.field.classList.add("half");
		age.field.classList.add("half");
		school.field.classList.add("half");
		const syncType = () => {
			const child = type.input.value === "child";
			age.field.hidden = !child;
			school.field.hidden = !child;
			age.input.required = child;
			school.input.required = child;
		};
		type.input.addEventListener("change", syncType);
		syncType();
		fields.append(name.field, type.field, age.field, school.field);
		const submit = createElement("button", "button small primary", "Add Saved Attendee");
		submit.type = "submit";
		addForm.append(createElement("h4", "", "Add a saved attendee"), fields, submit);
		addForm.addEventListener("submit", async (event) => {
			event.preventDefault();
			const child = type.input.value === "child";
			setFormBusy(addForm, true, "Adding...");
			const { error: insertError } = await supabase.from("household_members").insert({
				account_id: profile.id,
				full_name: name.input.value.trim(),
				attendee_type: type.input.value,
				age: child ? Number(age.input.value) : null,
				school_district: child ? school.input.value.trim() : null,
				grade: null,
			});
			setFormBusy(addForm, false);
			if (insertError) {
				toast(friendlyError(insertError, "The attendee could not be added."), "error");
				return;
			}
			toast("Saved attendee added.");
			await showMembers(profile);
		});
		memberPanel.appendChild(addForm);
		memberPanel.scrollIntoView({ behavior: "smooth", block: "start" });
	};

	const render = () => {
		const term = search.value.trim().toLowerCase();
		body.replaceChildren();
		const matches = profiles.filter((profile) => !term || `${profile.full_name} ${profile.email} ${profile.contact_email || ""}`.toLowerCase().includes(term));
		matches.forEach((profile) => {
			const row = createElement("tr");
			const actions = createElement("td", "pca-admin-row-actions");
			const edit = createElement("button", "button small", "Edit contact");
			edit.type = "button";
			edit.addEventListener("click", () => {
				if (row.nextElementSibling?.dataset.editorFor === profile.id) {
					row.nextElementSibling.remove();
					return;
				}
				body.querySelectorAll("[data-editor-for]").forEach((editor) => editor.remove());
				const editorRow = createElement("tr", "pca-admin-inline-row");
				editorRow.dataset.editorFor = profile.id;
				const cell = createElement("td");
				cell.colSpan = 4;
				const form = createElement("form", "pca-admin-inline-form");
				const fields = createElement("div", "fields");
				const name = createInlineField("Contact name", "full_name", "text", profile.full_name);
				const email = createInlineField("Contact email", "contact_email", "email", profile.contact_email || profile.email);
				const phone = createInlineField("Contact phone", "contact_phone", "tel", profile.contact_phone || "", { required: false });
				[name, email, phone].forEach((item) => item.field.classList.add("third"));
				fields.append(name.field, email.field, phone.field);
				const save = createElement("button", "button small primary", "Save Contact");
				save.type = "submit";
				const cancel = createElement("button", "button small", "Cancel");
				cancel.type = "button";
				cancel.addEventListener("click", () => editorRow.remove());
				const buttons = createElement("div", "pca-admin-decision__actions");
				buttons.append(save, cancel);
				form.append(fields, buttons);
				form.addEventListener("submit", async (event) => {
					event.preventDefault();
					setFormBusy(form, true, "Saving...");
					const { error: saveError } = await supabase.rpc("save_account_profile", {
						p_user_id: profile.id,
						p_full_name: name.input.value.trim(),
						p_contact_email: email.input.value.trim(),
						p_contact_phone: phone.input.value.trim(),
					});
					setFormBusy(form, false);
					if (saveError) {
						toast(friendlyError(saveError, "The contact details could not be saved."), "error");
						return;
					}
					toast("Contact details saved.");
					await loadHouseholds(page, supabase);
				});
				cell.appendChild(form);
				editorRow.appendChild(cell);
				row.insertAdjacentElement("afterend", editorRow);
				name.input.focus();
			});
			const members = createElement("button", "button small", "Saved attendees");
			members.type = "button";
			members.addEventListener("click", () => showMembers(profile).catch((memberError) => toast(friendlyError(memberError), "error")));
			const reset = createElement("button", "button small", "Password reset");
			reset.type = "button";
			reset.addEventListener("click", async () => {
				const confirmed = await confirmDialog({
					title: "Send a password reset email?",
					message: `A reset link will be sent to ${profile.email}.`,
					confirmLabel: "Send email",
					cancelLabel: "Not now",
				});
				if (!confirmed) return;
				const redirectTo = new URL("reset-password.html?mode=recovery", window.location.href).href;
				const { error: resetError } = await supabase.auth.resetPasswordForEmail(profile.email, { redirectTo });
				if (resetError) toast(friendlyError(resetError), "error");
				else toast(`Password reset email sent to ${profile.email}.`);
			});
			const removeAccount = createElement("button", "button small pca-button-danger", "Delete");
			removeAccount.type = "button";
			removeAccount.addEventListener("click", () => deleteManagedAccount(supabase, profile, async () => {
				memberPanel.hidden = true;
				await loadHouseholds(page, supabase);
			}));
			actions.append(edit, members, reset, removeAccount);
			const nameCell = createElement("td");
			nameCell.appendChild(createElement("strong", "", profile.full_name));
			if (profile.contact_email && profile.contact_email !== profile.email) nameCell.appendChild(createElement("span", "pca-table-subtext", `Signs in as ${profile.email}`));
			row.append(nameCell, tableCell(profile.contact_email || profile.email), tableCell(profile.contact_phone), actions);
			body.appendChild(row);
		});
		if (!matches.length) {
			const row = createElement("tr");
			const empty = createElement("td", "pca-admin-empty", term ? "No households match that search." : "No household accounts yet.");
			empty.colSpan = 4;
			row.appendChild(empty);
			body.appendChild(row);
		}
	};
	if (!search.dataset.bound) {
		search.dataset.bound = "true";
		search.addEventListener("input", render);
	}
	render();
};

// --- Volunteer accounts -----------------------------------------------------

const roleLabels = { student_council: "Student Council", editor: "Blog Editor", volunteer: "Volunteer" };

const loadVolunteerAccounts = async (page, supabase) => {
	const [applicationsResult, profilesResult, rolesResult] = await Promise.all([
		supabase.from("volunteer_applications").select("id,user_id,age,phone,school_name,status,admin_notes,submitted_at,reviewed_at").order("submitted_at", { ascending: false }),
		supabase.from("account_profiles").select("id,full_name,email,account_type").eq("account_type", "teen_member").order("full_name"),
		supabase.from("teen_member_role_assignments").select("user_id,role,revoked_at").is("revoked_at", null),
	]);
	for (const result of [applicationsResult, profilesResult, rolesResult]) if (result.error) throw result.error;
	const applications = new Map(applicationsResult.data.map((application) => [application.user_id, application]));
	const list = page.querySelector("[data-admin-teens-list]");
	list.replaceChildren();
	const sorted = [...profilesResult.data].sort((a, b) => {
		const rank = (profile) => (applications.get(profile.id)?.status === "pending" ? 0 : 1);
		return rank(a) - rank(b) || a.full_name.localeCompare(b.full_name);
	});
	sorted.forEach((profile) => {
		const application = applications.get(profile.id);
		const currentRoles = new Set(rolesResult.data.filter((role) => role.user_id === profile.id).map((role) => role.role));
		const entry = createElement("article", `pca-admin-record is-${application?.status || "pending"}`);
		const main = createElement("div", "pca-admin-record__main");
		const titleRow = createElement("div", "pca-admin-record__title");
		titleRow.append(createElement("strong", "", profile.full_name), makeBadge(application?.status || "pending"));
		main.appendChild(titleRow);
		const meta = createElement("p", "pca-admin-record__meta");
		meta.appendChild(makeMailLink(profile.email));
		if (application?.phone) meta.appendChild(createElement("span", "", application.phone));
		if (application?.age != null) meta.appendChild(createElement("span", "", `Age ${application.age}`));
		if (application?.school_name) meta.appendChild(createElement("span", "", application.school_name));
		if (application?.submitted_at) meta.appendChild(createElement("span", "", `Applied ${formatShortDate(application.submitted_at)}`));
		main.appendChild(meta);
		if (!application) main.appendChild(createElement("p", "pca-admin-record__note", "No application details on file yet."));
		if (application?.admin_notes) main.appendChild(createElement("p", "pca-admin-record__note", `Note: ${application.admin_notes}`));

		const roles = createElement("div", "pca-admin-record__roles");
		["volunteer", "student_council", "editor"].forEach((role) => {
			const label = createElement("label", "pca-inline-check");
			const checkbox = createElement("input");
			checkbox.type = "checkbox";
			checkbox.value = role;
			checkbox.checked = currentRoles.has(role);
			checkbox.disabled = application?.status !== "approved";
			label.append(checkbox, document.createTextNode(` ${roleLabels[role]}`));
			roles.appendChild(label);
		});
		main.appendChild(roles);

		const actions = createElement("div", "pca-admin-record__actions");
		const decisionHost = createElement("div", "pca-admin-record__details");
		decisionHost.hidden = true;
		const openDecision = (decision) => {
			decisionHost.replaceChildren(createDecisionForm({
				decision,
				label: decision === "approved" ? "Approve account" : "Decline application",
				notesLabel: decision === "approved" ? "Message to the volunteer (optional)" : "Reason (optional, shared with the applicant)",
				notesValue: application.admin_notes || "",
				onCancel: () => { decisionHost.hidden = true; },
				onConfirm: async (notes) => {
					const { error } = await supabase.rpc("review_volunteer_account_application", { p_application_id: application.id, p_decision: decision, p_admin_notes: notes });
					if (error) throw error;
					if (decision === "approved") await requestTransactionalEmail(supabase, "volunteer_account_approved", application.id);
					toast(decision === "approved" ? `${profile.full_name} is approved as a volunteer.` : `${profile.full_name}'s application was declined.`);
					await Promise.all([loadVolunteerAccounts(page, supabase), loadOverview(page, supabase), loadVolunteerManagement(page, supabase)]);
				},
			}));
			decisionHost.hidden = false;
			decisionHost.querySelector("textarea")?.focus();
		};
		if (application?.status === "pending") {
			const approve = createElement("button", "button small primary", "Approve");
			approve.type = "button";
			approve.addEventListener("click", () => openDecision("approved"));
			const reject = createElement("button", "button small", "Decline");
			reject.type = "button";
			reject.addEventListener("click", () => openDecision("rejected"));
			actions.append(approve, reject);
		} else if (application?.status === "approved") {
			const saveRoles = createElement("button", "button small primary", "Save roles");
			saveRoles.type = "button";
			saveRoles.addEventListener("click", async () => {
				const selected = [...roles.querySelectorAll("input:checked")].map((input) => input.value);
				saveRoles.disabled = true;
				const { error } = await supabase.rpc("replace_teen_member_roles", { p_user_id: profile.id, p_roles: selected });
				saveRoles.disabled = false;
				if (error) toast(friendlyError(error, "Roles could not be saved."), "error");
				else toast(`Roles saved for ${profile.full_name}.`);
			});
			actions.appendChild(saveRoles);
		}
		const removeAccount = createElement("button", "button small pca-button-danger", "Delete");
		removeAccount.type = "button";
		removeAccount.addEventListener("click", () => deleteManagedAccount(supabase, profile, () => loadVolunteerAccounts(page, supabase)));
		actions.appendChild(removeAccount);
		entry.append(main, actions, decisionHost);
		list.appendChild(entry);
	});
	if (!profilesResult.data.length) list.appendChild(createElement("p", "pca-empty-state", "No Volunteer Accounts have been created yet."));
};

// --- Volunteer requests -----------------------------------------------------

const requestsState = { showReviewed: false };

const loadVolunteerRequests = async (page, supabase) => {
	const list = page.querySelector("[data-admin-volunteer-requests]");
	if (!list) return;
	const [requestsResult, eventsResult] = await Promise.all([
		supabase.from("event_volunteer_requests").select("*").order("submitted_at", { ascending: false }),
		supabase.from("events").select("id,title,starts_at,event_date"),
	]);
	if (requestsResult.error) throw requestsResult.error;
	if (eventsResult.error) throw eventsResult.error;
	const events = new Map((eventsResult.data || []).map((event) => [event.id, event]));
	const toggle = page.querySelector("[data-admin-requests-reviewed]");
	if (toggle && !toggle.dataset.bound) {
		toggle.dataset.bound = "true";
		toggle.addEventListener("change", () => {
			requestsState.showReviewed = toggle.checked;
			void loadVolunteerRequests(page, supabase);
		});
	}
	list.replaceChildren();
	const requests = (requestsResult.data || []).filter((request) => requestsState.showReviewed || request.status === "pending");
	requests.forEach((request) => {
		const event = events.get(request.event_id);
		const entry = createElement("article", `pca-admin-record is-${request.status}`);
		const main = createElement("div", "pca-admin-record__main");
		const titleRow = createElement("div", "pca-admin-record__title");
		titleRow.append(createElement("strong", "", request.full_name), makeBadge(request.status));
		main.appendChild(titleRow);
		const meta = createElement("p", "pca-admin-record__meta");
		meta.appendChild(makeMailLink(request.email));
		if (request.phone) meta.appendChild(createElement("span", "", request.phone));
		meta.appendChild(createElement("span", "", `Age ${request.age}`));
		if (request.school_name) meta.appendChild(createElement("span", "", request.school_name));
		meta.appendChild(createElement("span", "", `Sent ${formatShortDate(request.submitted_at)}`));
		main.appendChild(meta);
		main.appendChild(makeMetaLine([event ? `For ${event.title}${event.starts_at ? `, ${formatShortDate(event.starts_at)}` : ""}` : "For an archived event"]));
		if (request.interests) main.appendChild(createElement("p", "pca-admin-record__note", `Wants to help with: ${request.interests}`));
		if (request.availability) main.appendChild(createElement("p", "pca-admin-record__note", `Availability: ${request.availability}`));
		if (request.admin_notes) main.appendChild(createElement("p", "pca-admin-record__note", `Note: ${request.admin_notes}`));
		main.appendChild(makeMetaLine([request.future_event_emails ? "Wants future event emails" : "No future event emails"]));

		const actions = createElement("div", "pca-admin-record__actions");
		const decisionHost = createElement("div", "pca-admin-record__details");
		decisionHost.hidden = true;
		if (request.status === "pending") {
			const openDecision = (decision) => {
				decisionHost.replaceChildren(createDecisionForm({
					decision,
					label: decision === "approved" ? "Approve and email" : "Decline request",
					notesLabel: decision === "approved" ? "Instructions for the volunteer (optional, included in the email)" : "Reason (optional)",
					notesValue: request.admin_notes || "",
					onCancel: () => { decisionHost.hidden = true; },
					onConfirm: async (notes) => {
						const { error } = await supabase.rpc("review_event_volunteer_request", { p_request_id: request.id, p_decision: decision, p_admin_notes: notes });
						if (error) throw error;
						if (decision === "approved") await requestTransactionalEmail(supabase, "volunteer_request_approved", request.id);
						toast(decision === "approved" ? `${request.full_name} was approved.` : `${request.full_name}'s request was declined.`);
						await Promise.all([loadVolunteerRequests(page, supabase), loadOverview(page, supabase)]);
					},
				}));
				decisionHost.hidden = false;
				decisionHost.querySelector("textarea")?.focus();
			};
			const approve = createElement("button", "button small primary", "Approve");
			approve.type = "button";
			approve.addEventListener("click", () => openDecision("approved"));
			const reject = createElement("button", "button small", "Decline");
			reject.type = "button";
			reject.addEventListener("click", () => openDecision("rejected"));
			actions.append(approve, reject);
		}
		entry.append(main, actions, decisionHost);
		list.appendChild(entry);
	});
	if (!requests.length) {
		list.appendChild(createElement("p", "pca-empty-state", requestsState.showReviewed ? "No volunteer requests yet." : "No requests waiting for review."));
	}
};

// --- Assignments and hours --------------------------------------------------

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
	volunteerSelect.firstElementChild.value = "";
	eventSelect.firstElementChild.value = "";
	rolesResult.data.forEach((assignment) => {
		const profile = profiles.get(assignment.user_id);
		if (!profile) return;
		const option = createElement("option", "", profile.full_name);
		option.value = profile.id;
		volunteerSelect.appendChild(option);
	});
	eventsResult.data.forEach((event) => {
		const option = createElement("option", "", `${event.title} (${eventDateTableValue(event) || "date to be announced"})`);
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
		const statusCell = createElement("td");
		const statusSelect = createElement("select");
		statusSelect.setAttribute("aria-label", `Status for ${profiles.get(assignment.teen_member_user_id)?.full_name || "assignment"}`);
		[["assigned", "Assigned"], ["completed", "Completed"], ["cancelled", "Cancelled"]].forEach(([value, label]) => {
			const option = createElement("option", "", label);
			option.value = value;
			option.selected = value === assignment.status;
			statusSelect.appendChild(option);
		});
		statusSelect.addEventListener("change", async () => {
			const { error } = await supabase.from("event_volunteer_assignments").update({ status: statusSelect.value }).eq("id", assignment.id);
			if (error) toast(friendlyError(error, "The status could not be saved."), "error");
			else toast("Assignment updated.");
		});
		statusCell.appendChild(statusSelect);
		const roleCell = tableCell(assignment.role_title);
		if (assignment.instructions) roleCell.appendChild(createElement("span", "pca-table-subtext", assignment.instructions));
		row.append(tableCell(profiles.get(assignment.teen_member_user_id)?.full_name), tableCell(events.get(assignment.event_id)?.title), roleCell, statusCell);
		assignmentBody.appendChild(row);
	});
	if (!assignmentsResult.data.length) {
		const row = createElement("tr");
		const empty = createElement("td", "pca-admin-empty", "No assignments yet.");
		empty.colSpan = 4;
		row.appendChild(empty);
		assignmentBody.appendChild(row);
	}

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
			const notesLabel = createElement("label", "", "Note");
			const notes = createElement("input");
			notes.type = "text";
			notes.maxLength = 2000;
			notes.placeholder = "Required when declining";
			notesLabel.appendChild(notes);
			const buttonRow = createElement("div", "pca-admin-hours-review__actions");
			const approve = createElement("button", "button small primary", "Approve");
			approve.type = "submit";
			reviewForm.addEventListener("submit", async (event) => {
				event.preventDefault();
				const approved = Number(approvedHours.value);
				if (!Number.isFinite(approved)) return;
				setFormBusy(reviewForm, true, "Approving...");
				const { error } = await supabase.from("volunteer_service_hours").update({ status: "approved", approved_hours: approved, admin_notes: notes.value.trim() || null }).eq("id", entry.id);
				setFormBusy(reviewForm, false);
				if (error) toast(friendlyError(error, "The hours could not be approved."), "error");
				else {
					toast("Hours approved.");
					await loadVolunteerManagement(page, supabase);
				}
			});
			const reject = createElement("button", "button small", "Decline");
			reject.type = "button";
			reject.addEventListener("click", async () => {
				if (!notes.value.trim()) {
					notes.required = true;
					notes.reportValidity();
					return;
				}
				reject.disabled = true;
				const { error } = await supabase.from("volunteer_service_hours").update({ status: "rejected", approved_hours: null, admin_notes: notes.value.trim() }).eq("id", entry.id);
				if (error) {
					toast(friendlyError(error, "The hours could not be declined."), "error");
					reject.disabled = false;
				} else {
					toast("Hours declined.");
					await loadVolunteerManagement(page, supabase);
				}
			});
			buttonRow.append(approve, reject);
			reviewForm.append(hoursLabel, notesLabel, buttonRow);
			review.appendChild(reviewForm);
		} else {
			review.appendChild(makeBadge(entry.status));
			if (entry.approved_hours != null && entry.status === "approved") review.appendChild(createElement("span", "pca-table-subtext", `${entry.approved_hours} approved`));
			if (entry.admin_notes) review.appendChild(createElement("span", "pca-table-subtext", entry.admin_notes));
		}
		const assignment = assignments.get(entry.assignment_id);
		const workCell = tableCell(entry.description);
		if (assignment?.role_title) workCell.appendChild(createElement("span", "pca-table-subtext", `${assignment.role_title}${events.get(assignment.event_id) ? `, ${events.get(assignment.event_id).title}` : ""}`));
		row.append(tableCell(profiles.get(entry.teen_member_user_id)?.full_name), tableCell(formatShortDate(`${entry.service_date}T12:00:00`)), tableCell(entry.submitted_hours), workCell, tableCell(reviewStatusLabels[entry.status] || entry.status), review);
		hoursBody.appendChild(row);
	});
	if (!hoursResult.data.length) {
		const row = createElement("tr");
		const empty = createElement("td", "pca-admin-empty", "No hours have been submitted yet.");
		empty.colSpan = 6;
		row.appendChild(empty);
		hoursBody.appendChild(row);
	}
};

// --- Access -----------------------------------------------------------------

const loadAccess = async (page, supabase, context) => {
	const panel = page.querySelector('[data-admin-panel="access"]');
	const tab = page.querySelector('[data-admin-tab="access"]');
	if (context.admin_level !== "super_admin") {
		panel?.remove();
		tab?.previousElementSibling?.matches(".pca-admin-tab-group") && tab.previousElementSibling.remove();
		tab?.remove();
		return;
	}
	const [adminsResult, profilesResult] = await Promise.all([
		supabase.from("site_administrators").select("*").order("granted_at"),
		supabase.from("account_profiles").select("id,full_name,email").order("full_name"),
	]);
	if (adminsResult.error) throw adminsResult.error;
	if (profilesResult.error) throw profilesResult.error;
	const profiles = new Map(profilesResult.data.map((profile) => [profile.id, profile]));
	const levelLabels = { super_admin: "Super Administrator", admin: "Administrator" };
	const body = page.querySelector("[data-admin-access-body]");
	body.replaceChildren();
	adminsResult.data.forEach((administrator) => {
		const profile = profiles.get(administrator.user_id);
		const row = createElement("tr");
		const actions = createElement("td");
		if (administrator.user_id !== context.user_id) {
			const remove = createElement("button", "button small pca-button-danger", "Remove access");
			remove.type = "button";
			remove.addEventListener("click", async () => {
				const confirmed = await confirmDialog({
					title: `Remove administrator access from ${profile?.full_name || "this account"}?`,
					message: "They keep their PCA account but can no longer open this workspace.",
					confirmLabel: "Remove access",
					cancelLabel: "Keep access",
					danger: true,
				});
				if (!confirmed) return;
				const { error } = await supabase.rpc("demote_admin", { p_user_id: administrator.user_id });
				if (error) toast(friendlyError(error), "error");
				else {
					toast("Administrator access removed.");
					await loadAccess(page, supabase, context);
				}
			});
			actions.appendChild(remove);
		} else {
			actions.textContent = "You";
		}
		row.append(tableCell(profile?.full_name), tableCell(profile?.email), tableCell(levelLabels[administrator.access_level] || administrator.access_level), actions);
		body.appendChild(row);
	});
	const form = page.querySelector("[data-admin-access-form]");
	const select = form.elements.user_id;
	select.replaceChildren(createElement("option", "", "Select an existing account"));
	select.firstElementChild.value = "";
	profilesResult.data.filter((profile) => !adminsResult.data.some((admin) => admin.user_id === profile.id)).forEach((profile) => {
		const option = createElement("option", "", `${profile.full_name} (${profile.email})`);
		option.value = profile.id;
		select.appendChild(option);
	});
	if (!form.dataset.bound) {
		form.dataset.bound = "true";
		form.addEventListener("submit", async (event) => {
			event.preventDefault();
			const values = new FormData(form);
			setFormBusy(form, true, "Granting...");
			const { error } = await supabase.rpc("promote_account_to_admin", { p_user_id: values.get("user_id"), p_access_level: values.get("access_level") });
			setFormBusy(form, false);
			if (error) toast(friendlyError(error), "error");
			else {
				toast("Administrator access granted.");
				form.reset();
				await loadAccess(page, supabase, context);
			}
		});
	}
};

// --- Workspace ----------------------------------------------------------------

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
	const showTab = initializeWorkspaceTabs(page);
	initializeEventForm(page, supabase, showTab);
	initializeRosterTools(page, supabase);
	page.querySelector("[data-admin-email-retry]")?.addEventListener("click", async (event) => {
		event.currentTarget.disabled = true;
		event.currentTarget.textContent = "Retrying...";
		await loadEmailHealth(page, supabase, { retry: true });
	});

	const sections = [
		["overview", () => loadOverview(page, supabase)],
		["events", () => loadEvents(page, supabase, showTab)],
		["registrations", () => loadRegistrations(page, supabase)],
		["households", () => loadHouseholds(page, supabase)],
		["volunteer accounts", () => loadVolunteerAccounts(page, supabase)],
		["volunteer requests", () => loadVolunteerRequests(page, supabase)],
		["assignments", () => loadVolunteerManagement(page, supabase)],
		["access", () => loadAccess(page, supabase, context)],
	];
	const failures = [];
	await Promise.all(sections.map(async ([name, load]) => {
		try {
			await load();
		} catch (error) {
			console.error(`Administration section "${name}" could not be loaded.`, error);
			failures.push(name);
		}
	}));
	setStatus(status, failures.length ? `Some sections could not be loaded: ${failures.join(", ")}. Refresh to try again.` : "", failures.length ? "error" : "");
	void loadEmailHealth(page, supabase, { retry: true });
};

export const initializeAdministrationPages = async () => {
	await initializeAdminWorkspace();
};
