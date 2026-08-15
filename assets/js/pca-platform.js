const FEATURE_ROUTES = [
	{
		key: "accounts",
		selector: "[data-teen-application-page], [data-teen-dashboard], [data-household-dashboard]",
		load: () => import("./modules/accounts.js?v=20260815-production-revamp-v4"),
	},
	{
		key: "registration",
		selector: "[data-platform-registration], [data-volunteer-request-page]",
		load: () => import("./modules/events-registration.js?v=20260815-production-revamp-v4"),
	},
	{
		key: "blog",
		selector: "[data-blog-feed], [data-blog-post], [data-blog-editor]",
		load: () => import("./modules/blog.js?v=20260815-production-revamp-v4"),
	},
	{
		key: "administration",
		selector: "[data-platform-admin]",
		load: () => import("./modules/administration.js?v=20260815-production-revamp-v4"),
	},
	{
		key: "council",
		selector: "[data-council-roster], [data-platform-admin]",
		load: () => import("./modules/council.js?v=20260815-production-revamp-v4"),
	},
];

const loadActiveFeatures = async () => {
	const activeRoutes = FEATURE_ROUTES.filter(({ selector }) => document.querySelector(selector));
	const loadedFeatures = await Promise.all(activeRoutes.map(async ({ key, load }) => [key, await load()]));
	return Object.fromEntries(loadedFeatures);
};

const initializePlatform = async () => {
	const features = await loadActiveFeatures();

	// These shell builders add admin tabs and panels synchronously. Run them in
	// the established order before any initializer reads the completed tab list.
	features.administration?.prepareAdministrationShell();
	features.council?.prepareCouncilAdminShell();

	const initializers = [];
	if (features.accounts) initializers.push(features.accounts.initializeAccountPages());
	if (features.registration) initializers.push(features.registration.initializeRegistrationPages());
	if (features.blog) initializers.push(features.blog.initializeBlogPages());
	if (features.administration) initializers.push(features.administration.initializeAdministrationPages());
	if (features.council) initializers.push(features.council.initializeCouncilPages());

	await Promise.all(initializers);
};

initializePlatform().catch((error) => {
	console.error("PCA platform initialization failed.", error);
	document.querySelectorAll("[data-platform-status]").forEach((status) => {
		status.textContent = "This part of the PCA website is temporarily unavailable. Please refresh and try again.";
		status.classList.add("is-error");
		status.hidden = false;
	});
});
