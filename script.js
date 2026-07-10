const autoRevealKey = "pcaAutoRevealMain";
const revealSelectors = [
	"#main > .post",
	"#main > .posts > article",
	"#main > .pca-band",
	".pca-card",
	".pca-event",
	".pca-member",
	".pca-partner",
	".pca-placeholder",
	".image.main",
	".image.fit",
	"ul.actions",
	"#footer > section",
].join(",");

const revealMainContent = () => {
	const main = document.querySelector("#main");

	if (!main) {
		return;
	}

	const nav = document.querySelector("#nav");
	const navOffset = nav ? nav.offsetHeight + 24 : 44;
	const targetTop = Math.max(0, main.getBoundingClientRect().top + window.scrollY - navOffset);

	window.scrollTo({
		top: targetTop,
		behavior: "smooth",
	});
};

const setupScrollReveals = () => {
	const revealElements = Array.from(document.querySelectorAll(revealSelectors));

	const revealVisibleElements = () => {
		const revealLine = window.innerHeight * 0.92;

		revealElements.forEach((element) => {
			if (element.classList.contains("is-visible")) {
				return;
			}

			if (element.getBoundingClientRect().top < revealLine) {
				element.classList.add("is-visible");
			}
		});
	};

	revealElements.forEach((element, index) => {
		element.classList.add("pca-scroll-reveal");
		element.style.setProperty("--pca-reveal-delay", `${Math.min(index % 4, 3) * 55}ms`);
	});

	if (!("IntersectionObserver" in window)) {
		let ticking = false;

		const revealVisibleElementsOnFrame = () => {
			ticking = false;
			revealVisibleElements();

			if (revealElements.every((element) => element.classList.contains("is-visible"))) {
				window.removeEventListener("scroll", queueRevealCheck);
				window.removeEventListener("resize", queueRevealCheck);
			}
		};

		const queueRevealCheck = () => {
			if (ticking) {
				return;
			}

			ticking = true;
			window.requestAnimationFrame(revealVisibleElementsOnFrame);
		};

		window.addEventListener("scroll", queueRevealCheck, { passive: true });
		window.addEventListener("resize", queueRevealCheck);
		queueRevealCheck();
		return;
	}

	const observer = new IntersectionObserver(
		(entries) => {
			entries.forEach((entry) => {
				if (!entry.isIntersecting) {
					return;
				}

				entry.target.classList.add("is-visible");
				observer.unobserve(entry.target);
			});
		},
		{
			rootMargin: "0px 0px -12% 0px",
			threshold: 0.14,
		}
	);

	revealElements.forEach((element) => observer.observe(element));
	revealVisibleElements();

	window.setTimeout(revealVisibleElements, 250);
	window.setTimeout(() => {
		revealElements.forEach((element) => element.classList.add("is-visible"));
	}, 1200);
};

const setupMobileNavPanelState = () => {
	const navPanel = document.querySelector("#navPanel");
	const wrapper = document.querySelector("#wrapper");
	const mobileNavQuery = window.matchMedia("(max-width: 980px)");

	if (!navPanel || !wrapper) {
		return;
	}

	const syncNavPanelState = () => {
		const isVisible = document.body.classList.contains("is-navPanel-visible") && mobileNavQuery.matches;

		if (isVisible) {
			navPanel.style.setProperty("-webkit-transform", "translateX(0)", "important");
			navPanel.style.setProperty("-ms-transform", "translateX(0)", "important");
			navPanel.style.setProperty("transform", "translateX(0)", "important");
			navPanel.style.setProperty("visibility", "visible", "important");
			navPanel.style.setProperty("box-shadow", "0 0 1.5rem 0 rgba(0, 0, 0, 0.2)", "important");
			wrapper.style.setProperty("opacity", "0.5", "important");
			return;
		}

		navPanel.style.removeProperty("-webkit-transform");
		navPanel.style.removeProperty("-ms-transform");
		navPanel.style.removeProperty("transform");
		navPanel.style.removeProperty("visibility");
		navPanel.style.removeProperty("box-shadow");
		wrapper.style.removeProperty("opacity");
	};

	new MutationObserver(syncNavPanelState).observe(document.body, {
		attributes: true,
		attributeFilter: ["class"],
	});

	if (typeof mobileNavQuery.addEventListener === "function") {
		mobileNavQuery.addEventListener("change", syncNavPanelState);
	} else if (typeof mobileNavQuery.addListener === "function") {
		mobileNavQuery.addListener(syncNavPanelState);
	}

	syncNavPanelState();
};

const setupNavigationAccessibility = () => {
	const primaryNavigation = document.querySelector("#nav");
	const primaryLinks = primaryNavigation?.querySelector(".links");

	primaryNavigation?.setAttribute("aria-label", "Primary navigation");
	primaryLinks?.setAttribute("aria-label", "Main pages");
};

setupScrollReveals();
setupMobileNavPanelState();
setupNavigationAccessibility();

window.addEventListener("pageshow", () => {
	document.body.classList.remove("pca-page-leaving");
	document.body.classList.add("pca-page-ready");

	if (sessionStorage.getItem(autoRevealKey) === "true") {
		sessionStorage.removeItem(autoRevealKey);
		window.setTimeout(revealMainContent, 260);
	}
});

document.querySelectorAll('a[href]').forEach((link) => {
	link.addEventListener("click", (event) => {
		const href = link.getAttribute("href");

		if (!href || href.startsWith("#") || link.target || link.hasAttribute("download")) {
			return;
		}

		const nextUrl = new URL(href, window.location.href);
		const currentUrl = new URL(window.location.href);
		const isInternalPage = nextUrl.origin === currentUrl.origin && nextUrl.pathname.endsWith(".html");
		const isSamePageAnchor = nextUrl.pathname === currentUrl.pathname && nextUrl.hash;
		const navPanel = link.closest("#navPanel");
		const isNavTab = Boolean(link.closest("#nav .links, #navPanel"));
		const isSamePageTab = isNavTab && nextUrl.pathname === currentUrl.pathname && !nextUrl.hash;

		if (!isInternalPage || isSamePageAnchor) {
			return;
		}

		if (navPanel) {
			event.stopPropagation();
			document.body.classList.remove("is-navPanel-visible");
		}

		if (isSamePageTab) {
			event.preventDefault();
			window.setTimeout(revealMainContent, navPanel ? 260 : 0);
			return;
		}

		event.preventDefault();

		if (isNavTab) {
			sessionStorage.setItem(autoRevealKey, "true");
		}

		document.body.classList.add("pca-page-leaving");
		window.setTimeout(() => {
			window.location.href = nextUrl.href;
		}, navPanel ? 260 : 180);
	});
});

const loadPcaBackend = () => {
	if (document.querySelector('script[data-pca-backend-script]')) {
		return;
	}

	const backendScript = document.createElement("script");
	backendScript.src = "assets/js/pca-backend.js?v=20260710";
	backendScript.dataset.pcaBackendScript = "true";
	backendScript.defer = true;
	document.body.appendChild(backendScript);

	const platformScript = document.createElement("script");
	platformScript.src = "assets/js/pca-platform.js?v=20260710";
	platformScript.type = "module";
	platformScript.dataset.pcaPlatformScript = "true";
	document.body.appendChild(platformScript);
};

loadPcaBackend();
