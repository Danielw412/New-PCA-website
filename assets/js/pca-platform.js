import { syncPlatformNavigation } from "./modules/core-auth.js";
import { initializeAccountPages } from "./modules/accounts.js";
import { initializeRegistrationPages } from "./modules/events-registration.js";
import { initializeBlogPages } from "./modules/blog.js";
import { initializeAdministrationPages } from "./modules/administration.js";

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

