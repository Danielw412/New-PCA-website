const loginForm = document.querySelector("[data-login-form]");
const loginStatus = document.querySelector("[data-login-status]");

loginForm?.addEventListener("submit", (event) => {
	event.preventDefault();

	if (loginStatus) {
		loginStatus.textContent = "Login is not connected yet.";
	}
});
