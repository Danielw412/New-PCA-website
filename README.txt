Massively by HTML5 UP
html5up.net | @ajlkn
Free for personal and commercial use under the CCA 3.0 license (html5up.net/license)


This is Massively, a text-heavy, article-oriented design built around a huge background
image (with a new parallax implementation I'm testing) and scroll effects (powered by
Scrollex). A *slight* departure from all the one-pagers I've been doing lately, but one
that fulfills a few user requests and makes use of some new techniques I've been wanting
to try out. Enjoy it :)

Demo images* courtesy of Unsplash, a radtastic collection of CC0 (public domain) images
you can use for pretty much whatever.

(* = not included)

AJ
aj@lkn.io | @ajlkn


Credits:

	Demo Images:
		Unsplash (unsplash.com)

	Icons:
		Font Awesome (fontawesome.io)

	Other:
		jQuery (jquery.com)
		Scrollex (github.com/ajlkn/jquery.scrollex)
		Responsive Tools (github.com/ajlkn/responsive-tools)


PCA event registration backend
------------------------------

The live site uses the PCA-Backend Supabase project. Database changes are stored in
supabase/migrations. The browser uses the project's public publishable key; no secret
or service-role key belongs in this repository.

Run the site from an HTTP server instead of opening files directly:

	python -m http.server 3000

Open http://127.0.0.1:3000/ in a browser.

Administrator setup:

1. Create the administrator account from login.html.
2. In Supabase, open Authentication > Users and copy that user's UUID.
3. In Table Editor > admin_users, insert the UUID in user_id.
4. The same login page will now show an Admin navigation item for that account.

Event setup:

Create rows in Table Editor > events. All timestamps are timestamptz values and are
shown on the website in America/New_York. Set a positive capacity, set
max_participants_per_registration no higher than capacity, and set published to true
when the event is ready to appear publicly. Set registration_open to false to close
registration manually. Registration also closes automatically when starts_at is reached.

Authentication configuration:

Version 1 expects Authentication > Sign In / Providers > Email > Confirm email to be
disabled for instant account access. The website also handles confirmation-enabled
signups, so this setting can be enabled later without a code change. Add every deployed
site origin and local test origin to Authentication > URL Configuration redirect URLs.
The production site URL is https://danielw412.github.io/New-PCA-website/.
