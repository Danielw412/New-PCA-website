import { syncPlatformNavigation } from "./modules/core-auth.js?v=20260711-registration-fixes";
import { initializeAccountPages } from "./modules/accounts.js?v=20260711-registration-fixes";
import { initializeRegistrationPages } from "./modules/events-registration.js?v=20260711-registration-fixes";
import { initializeBlogPages } from "./modules/blog.js?v=20260711-registration-fixes";
import { initializeAdministrationPages } from "./modules/administration.js?v=20260711-registration-fixes";

const initializePlatform = async () => {
	await syncPlatformNavigation();
	await Promise.all([
		initializeAccountPages(),
		initializeRegistrationPages(),
		initializeBlogPages(),
		initializeAdministrationPages(),
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
