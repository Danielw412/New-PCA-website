const ASSET_VERSION = "20260812-production-revamp-v1";
const MOBILE_NAV_QUERY = window.matchMedia("(max-width: 980px)");
const REDUCED_MOTION_QUERY = window.matchMedia("(prefers-reduced-motion: reduce)");

if (!document.querySelector("style[data-pca-reduced-motion]")) {
	const reducedMotionStyles = document.createElement("style");
	reducedMotionStyles.dataset.pcaReducedMotion = "true";
	reducedMotionStyles.textContent = `
		@media (prefers-reduced-motion: reduce) {
			html { scroll-behavior: auto !important; }
			*, *::before, *::after {
				scroll-behavior: auto !important;
				animation-duration: 0.01ms !important;
				animation-iteration-count: 1 !important;
				transition-duration: 0.01ms !important;
			}
		}
	`;
	document.head.appendChild(reducedMotionStyles);
}

const body = document.body;
const header = document.querySelector(".site-header");
const navigation = document.querySelector("[data-site-nav]");
const menuToggle = document.querySelector("[data-site-menu-toggle]");
const menuBackgroundElements = [
	document.querySelector(".skip-link"),
	header?.querySelector(".site-brand"),
	document.getElementById("wrapper"),
].filter(Boolean);
let menuReturnFocus = null;

const focusableSelector = [
	'a[href]:not([tabindex="-1"])',
	'button:not([disabled]):not([hidden]):not([tabindex="-1"])',
	'input:not([disabled]):not([tabindex="-1"])',
	'select:not([disabled]):not([tabindex="-1"])',
	'textarea:not([disabled]):not([tabindex="-1"])',
].join(",");

const getDropdownButton = (dropdown) => {
	if (!dropdown) return null;
	return dropdown.matches("[data-pca-account-menu]")
		? dropdown.querySelector(".nav-account__row > button")
		: dropdown.querySelector(":scope > .nav-item__row > button, :scope > button");
};

const setSubmenuVisibility = (dropdown, open = dropdown?.classList.contains("is-open")) => {
	const submenu = dropdown?.querySelector(":scope > .nav-submenu");
	if (!submenu) return;

	const hidden = MOBILE_NAV_QUERY.matches && !open;
	submenu.hidden = hidden;
	if (hidden) submenu.setAttribute("aria-hidden", "true");
	else submenu.removeAttribute("aria-hidden");
};

const closeDropdown = (dropdown, restoreFocus = false) => {
	if (!dropdown) return;
	const button = getDropdownButton(dropdown);
	dropdown.classList.remove("is-open");
	button?.setAttribute("aria-expanded", "false");
	if (button && dropdown.matches("[data-pca-account-menu]")) button.setAttribute("aria-label", "Open account menu");
	if (button?.getAttribute("aria-controls") === "pca-nav-involved") button.setAttribute("aria-label", "Open Get Involved menu");
	setSubmenuVisibility(dropdown, false);
	if (restoreFocus) button?.focus();
};

const closeAllDropdowns = (except = null) => {
	document.querySelectorAll("[data-nav-dropdown].is-open").forEach((dropdown) => {
		if (dropdown !== except) closeDropdown(dropdown);
	});
};

const openDropdown = (dropdown) => {
	const button = getDropdownButton(dropdown);
	if (!button || button.hidden) return;
	closeAllDropdowns(dropdown);
	dropdown.classList.add("is-open");
	setSubmenuVisibility(dropdown, true);
	button.setAttribute("aria-expanded", "true");
	if (dropdown.matches("[data-pca-account-menu]")) button.setAttribute("aria-label", "Close account menu");
	if (button.getAttribute("aria-controls") === "pca-nav-involved") button.setAttribute("aria-label", "Close Get Involved menu");
};

const toggleDropdown = (dropdown) => {
	if (dropdown.classList.contains("is-open")) closeDropdown(dropdown);
	else openDropdown(dropdown);
};

document.querySelectorAll("[data-nav-dropdown]").forEach((dropdown) => {
	const button = getDropdownButton(dropdown);
	if (!button) return;
	let hoverCloseTimer = null;

	dropdown.addEventListener("mouseenter", () => {
		if (MOBILE_NAV_QUERY.matches || button.hidden) return;
		window.clearTimeout(hoverCloseTimer);
		openDropdown(dropdown);
	});

	dropdown.addEventListener("mouseleave", () => {
		if (MOBILE_NAV_QUERY.matches) return;
		hoverCloseTimer = window.setTimeout(() => closeDropdown(dropdown), 140);
	});

	button.addEventListener("click", (event) => {
		event.stopPropagation();
		toggleDropdown(dropdown);
	});

	button.addEventListener("keydown", (event) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			openDropdown(dropdown);
			const firstLink = dropdown.querySelector(".nav-submenu a");
			firstLink?.focus();
		} else if (event.key === "Escape") {
			event.preventDefault();
			closeDropdown(dropdown, true);
		}
	});

	dropdown.querySelector(".nav-submenu")?.addEventListener("keydown", (event) => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		closeDropdown(dropdown, true);
	});

	setSubmenuVisibility(dropdown, false);
});

const setMenuBackgroundInert = (inert) => {
	menuBackgroundElements.forEach((element) => {
		element.toggleAttribute("inert", inert);
		if (inert) element.setAttribute("aria-hidden", "true");
		else element.removeAttribute("aria-hidden");
	});
};

const setNavigationModalState = (open) => {
	if (!navigation || !header) return;

	if (!MOBILE_NAV_QUERY.matches) {
		header.removeAttribute("role");
		header.removeAttribute("aria-modal");
		header.removeAttribute("aria-label");
		navigation.removeAttribute("aria-hidden");
		return;
	}

	navigation.setAttribute("aria-hidden", String(!open));
	if (open) {
		header.setAttribute("role", "dialog");
		header.setAttribute("aria-modal", "true");
		header.setAttribute("aria-label", "Site menu");
	} else {
		header.removeAttribute("role");
		header.removeAttribute("aria-modal");
		header.removeAttribute("aria-label");
	}
};

const getMenuFocusables = () => {
	if (!navigation || !menuToggle) return [];
	return [menuToggle, ...navigation.querySelectorAll(focusableSelector)].filter((element) => (
		!element.hidden
		&& !element.closest("[hidden]")
		&& element.getClientRects().length > 0
	));
};

const setMenuOpen = (open, restoreFocus = false) => {
	if (!navigation || !menuToggle) return;
	const shouldOpen = Boolean(open && MOBILE_NAV_QUERY.matches);
	body.classList.toggle("is-menu-open", shouldOpen);
	menuToggle.setAttribute("aria-expanded", String(shouldOpen));
	menuToggle.querySelector(".site-menu-toggle__label").textContent = shouldOpen ? "Close" : "Menu";
	setNavigationModalState(shouldOpen);
	setMenuBackgroundInert(shouldOpen);

	if (shouldOpen) {
		menuReturnFocus = document.activeElement;
		window.requestAnimationFrame(() => {
			menuToggle.focus();
		});
		return;
	}

	closeAllDropdowns();
	if (restoreFocus && menuReturnFocus instanceof HTMLElement) menuReturnFocus.focus();
	menuReturnFocus = null;
};

menuToggle?.addEventListener("click", () => {
	setMenuOpen(!body.classList.contains("is-menu-open"), body.classList.contains("is-menu-open"));
});

navigation?.addEventListener("click", (event) => {
	if (event.target === navigation && MOBILE_NAV_QUERY.matches) {
		setMenuOpen(false, true);
		return;
	}

	const link = event.target.closest("a[href]");
	if (link && MOBILE_NAV_QUERY.matches) setMenuOpen(false);
});

document.addEventListener("click", (event) => {
	if (event.target.closest("[data-nav-dropdown]")) return;
	closeAllDropdowns();
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && body.classList.contains("is-menu-open")) {
		event.preventDefault();
		setMenuOpen(false, true);
		return;
	}

	if (event.key !== "Tab" || !body.classList.contains("is-menu-open") || !navigation) return;
	const focusable = getMenuFocusables();
	if (!focusable.length) return;
	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	if (!focusable.includes(document.activeElement)) {
		event.preventDefault();
		(event.shiftKey ? last : first).focus();
	} else if (event.shiftKey && document.activeElement === first) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault();
		first.focus();
	}
});

const handleNavigationBreakpoint = () => {
	setMenuOpen(false);
	document.querySelectorAll("[data-nav-dropdown]").forEach((dropdown) => {
		setSubmenuVisibility(dropdown, dropdown.classList.contains("is-open"));
	});
};

if (typeof MOBILE_NAV_QUERY.addEventListener === "function") {
	MOBILE_NAV_QUERY.addEventListener("change", handleNavigationBreakpoint);
} else {
	MOBILE_NAV_QUERY.addListener(handleNavigationBreakpoint);
}
handleNavigationBreakpoint();

let scrollFrame = null;
const updateHeaderState = () => {
	scrollFrame = null;
	header?.classList.toggle("is-scrolled", window.scrollY > 12);
};

window.addEventListener("scroll", () => {
	if (scrollFrame !== null) return;
	scrollFrame = window.requestAnimationFrame(updateHeaderState);
}, { passive: true });
updateHeaderState();

const setupScrollReveals = () => {
	const candidates = Array.from(document.querySelectorAll([
		"[data-reveal]",
		"#main:not(.home-main) > .post",
		"#main:not(.home-main) > .posts",
		"#main:not(.home-main) > .pca-band",
	].join(",")));

	if (!candidates.length) {
		return;
	}

	candidates.forEach((element) => element.setAttribute("data-reveal", ""));
	const revealAll = () => {
		body.classList.remove("pca-motion-ready");
		candidates.forEach((element) => element.classList.add("is-visible"));
	};

	if (REDUCED_MOTION_QUERY.matches) {
		revealAll();
		return;
	}

	body.classList.add("pca-motion-ready");
	const handleReducedMotion = (event) => {
		if (event.matches) revealAll();
	};
	if (typeof REDUCED_MOTION_QUERY.addEventListener === "function") {
		REDUCED_MOTION_QUERY.addEventListener("change", handleReducedMotion, { once: true });
	} else {
		REDUCED_MOTION_QUERY.addListener(handleReducedMotion);
	}

	const revealVisible = () => {
		candidates.forEach((element) => {
			if (element.getBoundingClientRect().top < window.innerHeight * 0.94) element.classList.add("is-visible");
		});
	};

	if (!("IntersectionObserver" in window)) {
		revealVisible();
		window.addEventListener("scroll", revealVisible, { passive: true });
		return;
	}

	const observer = new IntersectionObserver((entries) => {
		entries.forEach((entry) => {
			if (!entry.isIntersecting) return;
			entry.target.classList.add("is-visible");
			observer.unobserve(entry.target);
		});
	}, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

	candidates.forEach((element) => observer.observe(element));
	revealVisible();
};

setupScrollReveals();

const enhancePastEventArchive = () => {
	const archive = document.querySelector("[data-past-events-archive]");
	if (!archive) return;

	let currentYear = null;
	let archiveEntryIndex = 0;
	[...archive.children].forEach((element) => {
		if (element.matches("h2")) {
			currentYear = document.createElement("section");
			currentYear.className = "pca-archive-year";
			element.before(currentYear);
			currentYear.appendChild(element);
			return;
		}

		if (!currentYear || !element.matches(".pca-event")) {
			currentYear?.appendChild(element);
			return;
		}

		const heading = element.querySelector(":scope > h3");
		if (!heading) {
			currentYear.appendChild(element);
			return;
		}

		archiveEntryIndex += 1;
		element.classList.remove("pca-event");
		element.classList.add("pca-archive-entry");
		heading.className = "pca-archive-entry__heading";
		heading.style.margin = "0";
		const button = document.createElement("button");
		button.className = "pca-archive-entry__toggle";
		button.type = "button";
		button.setAttribute("aria-expanded", "false");
		const panelId = `pca-archive-panel-${archiveEntryIndex}`;
		button.setAttribute("aria-controls", panelId);
		const label = document.createElement("span");
		label.textContent = heading.textContent;
		const icon = document.createElement("span");
		icon.className = "icon solid fa-plus";
		icon.setAttribute("aria-hidden", "true");
		button.append(label, icon);

		const body = document.createElement("div");
		body.className = "pca-archive-entry__body";
		body.id = panelId;
		body.hidden = true;
		[...element.children].forEach((child) => {
			if (child !== heading) body.appendChild(child);
		});
		heading.replaceChildren(button);
		element.replaceChildren(heading, body);
		currentYear.appendChild(element);

		button.addEventListener("click", () => {
			const open = button.getAttribute("aria-expanded") !== "true";
			button.setAttribute("aria-expanded", String(open));
			body.hidden = !open;
		});
	});
};

enhancePastEventArchive();

const loadPcaBackend = () => {
	const hasBackendWorkflow = Boolean(document.querySelector([
		"[data-auth-forms]",
		"[data-password-recovery-page]",
		"[data-profile-page]",
		"[data-events-list]",
		"[data-past-events-list]",
		"[data-platform-registration]",
		"[data-volunteer-request-page]",
		"[data-blog-feed]",
		"[data-blog-post]",
		"[data-blog-editor]",
		"[data-platform-admin]",
		"[data-teen-application-page]",
		"[data-teen-dashboard]",
		"[data-household-dashboard]",
		"[data-council-roster]",
	].join(",")));
	let hasStoredSession = false;

	try {
		hasStoredSession = Boolean(window.localStorage.getItem("sb-ridpqdrikxpwddczdoks-auth-token"));
	} catch (error) {
		// Browsers may block storage in strict privacy modes. Loading the client is the
		// reliable fallback for keeping account navigation accurate in that case.
		hasStoredSession = true;
	}

	if (!hasBackendWorkflow && !hasStoredSession) return;

	const appendBackend = () => {
		if (document.querySelector("script[data-pca-backend-script]")) return;

		const backendScript = document.createElement("script");
		backendScript.src = `assets/js/pca-backend.js?v=${ASSET_VERSION}`;
		backendScript.dataset.pcaBackendScript = "true";
		backendScript.defer = true;
		document.body.appendChild(backendScript);

		const needsPlatform = document.querySelector([
			"[data-platform-registration]",
			"[data-volunteer-request-page]",
			"[data-blog-feed]",
			"[data-blog-post]",
			"[data-blog-editor]",
			"[data-platform-admin]",
			"[data-teen-application-page]",
			"[data-teen-dashboard]",
			"[data-household-dashboard]",
			"[data-council-roster]",
		].join(","));
		if (needsPlatform) {
			const platformScript = document.createElement("script");
			platformScript.src = `assets/js/pca-platform.js?v=${ASSET_VERSION}`;
			platformScript.type = "module";
			platformScript.dataset.pcaPlatformScript = "true";
			document.body.appendChild(platformScript);
		}
	};

	if (hasBackendWorkflow) {
		appendBackend();
	} else if ("requestIdleCallback" in window) {
		window.requestIdleCallback(appendBackend, { timeout: 1200 });
	} else {
		window.setTimeout(appendBackend, 0);
	}
};

loadPcaBackend();
