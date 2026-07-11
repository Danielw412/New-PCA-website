const ASSET_VERSION = "20260711-spacing-rhythm";
const MOBILE_NAV_QUERY = window.matchMedia("(max-width: 980px)");
const REDUCED_MOTION_QUERY = window.matchMedia("(prefers-reduced-motion: reduce)");

const body = document.body;
const header = document.querySelector(".site-header");
const navigation = document.querySelector("[data-site-nav]");
const menuToggle = document.querySelector("[data-site-menu-toggle]");
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
		: dropdown.querySelector(":scope > button");
};

const closeDropdown = (dropdown, restoreFocus = false) => {
	if (!dropdown) return;
	const button = getDropdownButton(dropdown);
	dropdown.classList.remove("is-open");
	button?.setAttribute("aria-expanded", "false");
	if (button && dropdown.matches("[data-pca-account-menu]")) button.setAttribute("aria-label", "Open account menu");
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
	button.setAttribute("aria-expanded", "true");
	if (dropdown.matches("[data-pca-account-menu]")) button.setAttribute("aria-label", "Close account menu");
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
});

const setMenuOpen = (open, restoreFocus = false) => {
	if (!navigation || !menuToggle) return;
	body.classList.toggle("is-menu-open", open);
	menuToggle.setAttribute("aria-expanded", String(open));
	menuToggle.querySelector(".site-menu-toggle__label").textContent = open ? "Close" : "Menu";

	if (open) {
		menuReturnFocus = document.activeElement;
		window.requestAnimationFrame(() => {
			navigation.querySelector(focusableSelector)?.focus();
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
	const focusable = Array.from(navigation.querySelectorAll(focusableSelector)).filter((element) => element.offsetParent !== null);
	if (!focusable.length) return;
	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	if (event.shiftKey && document.activeElement === first) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault();
		first.focus();
	}
});

const handleNavigationBreakpoint = () => {
	if (!MOBILE_NAV_QUERY.matches) setMenuOpen(false);
};

if (typeof MOBILE_NAV_QUERY.addEventListener === "function") {
	MOBILE_NAV_QUERY.addEventListener("change", handleNavigationBreakpoint);
} else {
	MOBILE_NAV_QUERY.addListener(handleNavigationBreakpoint);
}

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

	if (!candidates.length || REDUCED_MOTION_QUERY.matches) {
		candidates.forEach((element) => element.classList.add("is-visible"));
		return;
	}

	candidates.forEach((element) => element.setAttribute("data-reveal", ""));
	body.classList.add("pca-motion-ready");

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

const loadPcaBackend = () => {
	if (document.querySelector("script[data-pca-backend-script]")) return;

	const backendScript = document.createElement("script");
	backendScript.src = `assets/js/pca-backend.js?v=${ASSET_VERSION}`;
	backendScript.dataset.pcaBackendScript = "true";
	backendScript.defer = true;
	document.body.appendChild(backendScript);

	const platformScript = document.createElement("script");
	platformScript.src = `assets/js/pca-platform.js?v=${ASSET_VERSION}`;
	platformScript.type = "module";
	platformScript.dataset.pcaPlatformScript = "true";
	document.body.appendChild(platformScript);
};

loadPcaBackend();
