// Catch likely email-address typos before a form reaches Supabase. Addresses
// that cannot receive mail are blocked; near misses of common providers get a
// one-click suggestion and can still be submitted as typed on a second try.

const COMMON_EMAIL_DOMAINS = Object.freeze([
	"gmail.com",
	"googlemail.com",
	"yahoo.com",
	"ymail.com",
	"rocketmail.com",
	"hotmail.com",
	"outlook.com",
	"live.com",
	"msn.com",
	"icloud.com",
	"me.com",
	"mac.com",
	"aol.com",
	"aim.com",
	"comcast.net",
	"verizon.net",
	"att.net",
	"sbcglobal.net",
	"proton.me",
	"protonmail.com",
	"mail.com",
	"email.com",
	"gmx.com",
	"zoho.com",
	"yandex.com",
	"qq.com",
	"163.com",
	"126.com",
	"sina.com",
	"foxmail.com",
]);

// None of these are real top-level domains, so an address ending in one can
// never receive mail.
const MISTYPED_TOP_LEVEL_DOMAINS = Object.freeze({
	con: "com",
	cmo: "com",
	ocm: "com",
	comm: "com",
	vom: "com",
	xom: "com",
	cpm: "com",
	nte: "net",
	nett: "net",
	ogr: "org",
	orgg: "org",
	eud: "edu",
});

const INVALID_EMAIL_MESSAGE = "Enter a complete email address, like name@example.com.";
const LABEL = "[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]*[\\p{L}\\p{N}])?";
const DOMAIN_PATTERN = new RegExp(`^${LABEL}(?:\\.${LABEL})*\\.(?:\\p{L}{2,}|xn--[a-z0-9-]+)$`, "u");

// Optimal string alignment distance: insertions, deletions, substitutions, and
// adjacent transpositions ("gmial") each count as one edit.
const editDistance = (a, b) => {
	const rows = Array.from({ length: a.length + 1 }, (_, index) => [index, ...new Array(b.length).fill(0)]);
	for (let column = 1; column <= b.length; column += 1) rows[0][column] = column;
	for (let row = 1; row <= a.length; row += 1) {
		for (let column = 1; column <= b.length; column += 1) {
			const cost = a[row - 1] === b[column - 1] ? 0 : 1;
			rows[row][column] = Math.min(rows[row - 1][column] + 1, rows[row][column - 1] + 1, rows[row - 1][column - 1] + cost);
			if (row > 1 && column > 1 && a[row - 1] === b[column - 2] && a[row - 2] === b[column - 1]) {
				rows[row][column] = Math.min(rows[row][column], rows[row - 2][column - 2] + 1);
			}
		}
	}
	return rows[a.length][b.length];
};

const splitDomain = (domain) => {
	const dot = domain.lastIndexOf(".");
	return dot > 0 ? [domain.slice(0, dot), domain.slice(dot + 1)] : [domain, ""];
};

// Short provider names are too close to unrelated real domains to fuzzy-match.
const nameTolerance = (name) => (name.length < 3 ? 0 : name.length < 5 ? 1 : 2);

const closestCommonDomain = (domain) => {
	const [name, topLevel] = splitDomain(domain);
	let closest = null;
	let closestScore = Infinity;
	for (const candidate of COMMON_EMAIL_DOMAINS) {
		const [candidateName, candidateTopLevel] = splitDomain(candidate);
		const tolerance = nameTolerance(candidateName);
		let score = Infinity;
		if (!topLevel) {
			const distance = Math.min(editDistance(name, candidateName), editDistance(name, candidate.replaceAll(".", "")));
			if (distance <= tolerance) score = distance + 1;
		} else {
			// A different real country domain for the same provider (yahoo.ca,
			// hotmail.co.uk) is at least two edits away, so it is left alone.
			const nameDistance = editDistance(name, candidateName);
			const topLevelDistance = editDistance(topLevel, candidateTopLevel);
			if (nameDistance <= tolerance && topLevelDistance <= 1) score = nameDistance + topLevelDistance;
		}
		if (score > 0 && score < closestScore) {
			closest = candidate;
			closestScore = score;
		}
	}
	return closest;
};

export const checkEmailAddress = (value) => {
	const email = String(value ?? "").trim();
	if (!email) return { status: "empty" };

	const at = email.lastIndexOf("@");
	const local = email.slice(0, at);
	const domain = email.slice(at + 1).toLowerCase();
	if (at < 1 || !domain || local.includes("@") || /\s/.test(email)) {
		return { status: "invalid", message: INVALID_EMAIL_MESSAGE, suggestion: null };
	}
	if (COMMON_EMAIL_DOMAINS.includes(domain)) return { status: "ok" };

	const [name, topLevel] = splitDomain(domain);
	const fixedTopLevel = MISTYPED_TOP_LEVEL_DOMAINS[topLevel];
	const suggestedDomain = closestCommonDomain(domain) || (fixedTopLevel ? `${name}.${fixedTopLevel}` : null);
	const suggestion = suggestedDomain ? `${local}@${suggestedDomain}` : null;

	if (fixedTopLevel || !DOMAIN_PATTERN.test(domain)) {
		return {
			status: "invalid",
			message: suggestion ? `Check this email address. Did you mean ${suggestion}?` : INVALID_EMAIL_MESSAGE,
			suggestion,
		};
	}
	return suggestion ? { status: "suggest", suggestion } : { status: "ok" };
};

const hints = new WeakMap();
let hintCount = 0;
let installed = false;

const isEmailInput = (element) => element instanceof HTMLInputElement && element.type === "email";

const hintFor = (input) => {
	const existing = hints.get(input);
	if (existing?.isConnected) return existing;
	hintCount += 1;
	const hint = document.createElement("p");
	hint.className = "pca-email-suggestion";
	hint.id = `pca-email-suggestion-${hintCount}`;
	hint.setAttribute("aria-live", "polite");
	hint.hidden = true;
	input.insertAdjacentElement("afterend", hint);
	const describedBy = new Set((input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
	describedBy.add(hint.id);
	input.setAttribute("aria-describedby", [...describedBy].join(" "));
	hints.set(input, hint);
	return hint;
};

const hideHint = (input) => {
	const hint = hints.get(input);
	if (!hint) return;
	hint.hidden = true;
	hint.replaceChildren();
	delete hint.dataset.state;
};

const showHint = (input, result, confirming = false) => {
	const hint = hintFor(input);
	const state = JSON.stringify([result.status, result.suggestion, confirming]);
	// Re-rendering while the pointer is down on the suggestion button would
	// swallow its click, because blur fires between mousedown and click.
	if (!hint.hidden && hint.dataset.state === state) return;
	hint.dataset.state = state;
	hint.replaceChildren();
	if (result.suggestion) {
		const apply = document.createElement("button");
		apply.type = "button";
		apply.textContent = result.suggestion;
		apply.addEventListener("click", () => {
			input.value = result.suggestion;
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new Event("change", { bubbles: true }));
			input.focus();
		});
		hint.append("Did you mean ", apply, "?");
		if (confirming) hint.append(" Choose it, or submit again to keep the address as typed.");
	} else {
		hint.textContent = result.message;
	}
	hint.hidden = false;
};

const evaluateInput = (input) => {
	const result = checkEmailAddress(input.value);
	if (result.status === "invalid") {
		input.setCustomValidity(result.message);
		showHint(input, result);
	} else {
		input.setCustomValidity("");
		if (result.status === "suggest") showHint(input, result, input.dataset.emailTypoConfirmed === input.value.trim());
		else hideHint(input);
	}
	return result;
};

export const installEmailTypoGuard = (root = document) => {
	if (installed) return;
	installed = true;

	root.addEventListener("input", (event) => {
		if (!isEmailInput(event.target)) return;
		event.target.setCustomValidity("");
		delete event.target.dataset.emailTypoConfirmed;
		hideHint(event.target);
	});

	root.addEventListener("focusout", (event) => {
		if (isEmailInput(event.target)) evaluateInput(event.target);
	});

	// Capture on the document runs before each form's own submit handler, so a
	// blocked submission never reaches Supabase.
	root.addEventListener("submit", (event) => {
		const form = event.target;
		if (!(form instanceof HTMLFormElement)) return;
		for (const input of form.querySelectorAll('input[type="email"]')) {
			if (input.disabled || input.readOnly || input.closest("[hidden]") || !input.value.trim()) continue;
			const result = evaluateInput(input);
			const typed = input.value.trim();
			if (result.status === "ok" || (result.status === "suggest" && input.dataset.emailTypoConfirmed === typed)) continue;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (result.status === "suggest") {
				input.dataset.emailTypoConfirmed = typed;
				showHint(input, result, true);
				input.focus();
			} else {
				input.reportValidity();
			}
			return;
		}
	}, true);
};
