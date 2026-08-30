(function () {
	"use strict";

	const TURNSTILE_SITE_KEY = "0x4AAAAAAEiJOulNZbFK7gY4";
	const TURNSTILE_SCRIPT_ID = "pca-auth-turnstile-script";
	const TURNSTILE_ONLOAD_CALLBACK = "pcaAuthTurnstileOnload";
	const PATCH_FLAG = Symbol.for("pca.authCaptchaPatched");
	let turnstileReadinessPromise = null;

	const asError = (value, fallback) => {
		if (value instanceof Error) return value;
		return new Error(typeof value === "string" && value ? value : fallback);
	};

	const loadTurnstile = () => {
		if (window.turnstile) return Promise.resolve(window.turnstile);
		if (turnstileReadinessPromise) return turnstileReadinessPromise;

		turnstileReadinessPromise = new Promise((resolve, reject) => {
			const rejectLoad = () => reject(new Error("The security check could not be loaded. Please refresh and try again."));
			window[TURNSTILE_ONLOAD_CALLBACK] = () => {
				if (!window.turnstile) {
					rejectLoad();
					return;
				}
				resolve(window.turnstile);
			};

			let script = document.getElementById(TURNSTILE_SCRIPT_ID);
			if (!script) {
				script = document.createElement("script");
				script.id = TURNSTILE_SCRIPT_ID;
				script.src = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=${TURNSTILE_ONLOAD_CALLBACK}`;
				script.async = true;
				script.defer = true;
				script.onerror = rejectLoad;
				document.head.appendChild(script);
			}
		}).then((turnstile) => {
			delete window[TURNSTILE_ONLOAD_CALLBACK];
			return turnstile;
		}).catch((error) => {
			document.getElementById(TURNSTILE_SCRIPT_ID)?.remove();
			delete window[TURNSTILE_ONLOAD_CALLBACK];
			turnstileReadinessPromise = null;
			throw error;
		});

		return turnstileReadinessPromise;
	};

	const requestCaptchaToken = async () => {
		const turnstile = await loadTurnstile();
		const container = document.createElement("div");
		container.setAttribute("aria-hidden", "true");
		Object.assign(container.style, {
			position: "fixed",
			right: "0",
			bottom: "0",
			width: "1px",
			height: "1px",
			overflow: "hidden",
			opacity: "0.01",
			pointerEvents: "none",
			zIndex: "-1",
		});
		document.body.appendChild(container);

		return new Promise((resolve, reject) => {
			let widgetId;
			let settled = false;
			let timeoutId;
			let renderComplete = false;
			let pendingResult;

			const cleanup = () => {
				window.clearTimeout(timeoutId);
				if (renderComplete && widgetId !== undefined) {
					try { turnstile.remove(widgetId); } catch (error) { console.debug("Turnstile removal skipped.", error); }
				}
				container.remove();
			};

			const finish = (token, error) => {
				if (settled) return;
				if (!renderComplete) {
					pendingResult = [token, error];
					return;
				}
				settled = true;
				cleanup();
				if (error) reject(asError(error, "The security check failed. Please try again."));
				else resolve(token);
			};

			try {
				widgetId = turnstile.render(container, {
					sitekey: TURNSTILE_SITE_KEY,
					size: "invisible",
					execution: "execute",
					callback: (token) => finish(token),
					"error-callback": () => finish(null, "The security check failed. Please try again."),
					"expired-callback": () => finish(null, "The security check expired. Please try again."),
					"timeout-callback": () => finish(null, "The security check timed out. Please try again."),
				});
				renderComplete = true;
				if (pendingResult) {
					finish(...pendingResult);
					return;
				}
				timeoutId = window.setTimeout(
					() => finish(null, "The security check timed out. Please try again."),
					30000
				);
				turnstile.execute(widgetId);
			} catch (error) {
				renderComplete = true;
				finish(null, error);
			}
		});
	};

	const addCaptchaToken = async (options = {}) => {
		if (options.captchaToken) return options;
		return { ...options, captchaToken: await requestCaptchaToken() };
	};

	const captchaFailure = (error) => ({ data: null, error: asError(error, "The security check failed. Please try again.") });

	const installCaptchaProtection = () => {
		const auth = window.PCA?.supabase?.auth;
		if (!auth || auth[PATCH_FLAG]) return Boolean(auth);

		const wrapCredentialsMethod = (methodName) => {
			if (typeof auth[methodName] !== "function") return;
			const original = auth[methodName].bind(auth);
			auth[methodName] = async (credentials = {}) => {
				try {
					return await original({
						...credentials,
						options: await addCaptchaToken(credentials.options || {}),
					});
				} catch (error) {
					return captchaFailure(error);
				}
			};
		};

		wrapCredentialsMethod("signInWithPassword");
		wrapCredentialsMethod("signUp");
		wrapCredentialsMethod("signInAnonymously");

		if (typeof auth.resetPasswordForEmail === "function") {
			const originalResetPasswordForEmail = auth.resetPasswordForEmail.bind(auth);
			auth.resetPasswordForEmail = async (email, options = {}) => {
				try {
					return await originalResetPasswordForEmail(email, await addCaptchaToken(options));
				} catch (error) {
					return captchaFailure(error);
				}
			};
		}

		Object.defineProperty(auth, PATCH_FLAG, { value: true });
		return true;
	};

	if (!installCaptchaProtection()) {
		document.addEventListener("pca:backend-ready", installCaptchaProtection, { once: true });
	}
})();
