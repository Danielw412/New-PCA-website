import { initializeAccountPages } from "./modules/accounts.js?v=20260728-content-layout-v3";
import { initializeRegistrationPages } from "./modules/events-registration.js?v=20260728-content-layout-v3";
import { initializeBlogPages } from "./modules/blog.js?v=20260728-content-layout-v3";
import { initializeAdministrationPages, prepareAdministrationShell } from "./modules/administration.js?v=20260728-content-layout-v3";
import { initializeCouncilPages, prepareCouncilAdminShell } from "./modules/council.js?v=20260728-content-layout-v3";

const initializePlatform = async () => {
	prepareAdministrationShell();
	prepareCouncilAdminShell();
	await Promise.all([
		initializeAccountPages(),
		initializeRegistrationPages(),
		initializeBlogPages(),
		initializeAdministrationPages(),
		initializeCouncilPages(),
	]);
};

initializePlatform().catch((error) => {
	console.error("PCA platform initialization failed.", error);
	document.querySelectorAll("[data-platform-status]").forEach((status) => {
		status.textContent = "This part of the PCA website is temporarily unavailable. Please refresh and try again.";
		status.classList.add("is-error");
		status.hidden = false;
	});
});
