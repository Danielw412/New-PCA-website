import {
	createElement,
	formatShortDate,
	friendlyError,
	getAccountContext,
	getSession,
	platformReady,
	setFormBusy,
	setStatus,
} from "./core-auth.js?v=20260711-registration-fixes";
import { importedPosts } from "./blog-seed.js?v=20260711-registration-fixes";

const imageUrl = (supabase, source, path) => {
	if (!source || !path) return "";
	if (source === "local") return path;
	return supabase.storage.from("blog-media").getPublicUrl(path).data.publicUrl;
};

const fetchPublishedPosts = async (supabase) => {
	const { data, error } = await supabase
		.from("blog_posts")
		.select("*")
		.eq("status", "published")
		.order("published_at", { ascending: false });
	if (!error) return data || [];
	if (/relation .*blog_posts.* does not exist|schema cache/i.test(error.message || "")) return importedPosts;
	throw error;
};

const renderPostCard = (post, supabase) => {
	const card = createElement("article", "pca-card pca-blog-card");
	const coverUrl = imageUrl(supabase, post.cover_image_source, post.cover_image_path);
	if (coverUrl) {
		const link = createElement("a", "image fit pca-blog-cover");
		link.href = `post.html?slug=${encodeURIComponent(post.slug)}`;
		const image = createElement("img");
		image.src = coverUrl;
		image.alt = post.cover_image_alt || "";
		image.loading = "lazy";
		link.appendChild(image);
		card.appendChild(link);
	}
	const meta = createElement("p", "pca-blog-meta", `${post.author_display_name} · ${formatShortDate(post.published_at)}`);
	const title = createElement("h2");
	const titleLink = createElement("a", "", post.title);
	titleLink.href = `post.html?slug=${encodeURIComponent(post.slug)}`;
	title.appendChild(titleLink);
	card.append(meta, title, createElement("p", "", post.excerpt));
	const actions = createElement("ul", "actions");
	const item = createElement("li");
	const read = createElement("a", "button", "Read Article");
	read.href = titleLink.href;
	item.appendChild(read);
	actions.appendChild(item);
	card.appendChild(actions);
	return card;
};

const renderStructuredContent = (container, blocks, supabase) => {
	container.replaceChildren();
	(blocks || []).forEach((block) => {
		if (block.type === "heading") {
			container.appendChild(createElement(block.level === 3 ? "h3" : "h2", "", block.text));
		} else if (block.type === "paragraph") {
			container.appendChild(createElement("p", "", block.text));
		} else if (block.type === "quote") {
			container.appendChild(createElement("blockquote", "", block.text));
		} else if (block.type === "image") {
			const figure = createElement("figure", "pca-blog-inline-image");
			const image = createElement("img");
			image.src = imageUrl(supabase, block.source, block.path);
			image.alt = block.alt;
			image.loading = "lazy";
			figure.appendChild(image);
			container.appendChild(figure);
		}
	});
};

const initializeBlogFeed = async () => {
	const page = document.querySelector("[data-blog-feed]");
	if (!page) return;
	const { supabase } = await platformReady();
	const status = page.querySelector("[data-blog-status]");
	const list = page.querySelector("[data-blog-list]");
	try {
		const posts = await fetchPublishedPosts(supabase);
		list.replaceChildren();
		posts.forEach((post) => list.appendChild(renderPostCard(post, supabase)));
		if (!posts.length) list.appendChild(createElement("p", "pca-empty-state", "No published articles yet."));
		setStatus(status);
	} catch (error) {
		setStatus(status, friendlyError(error, "Blog posts could not be loaded."), "error");
	}
};

const initializeBlogPost = async () => {
	const page = document.querySelector("[data-blog-post]");
	if (!page) return;
	const { supabase } = await platformReady();
	const slug = new URLSearchParams(window.location.search).get("slug");
	const status = page.querySelector("[data-blog-post-status]");
	if (!slug) {
		setStatus(status, "Choose an article from the blog.", "error");
		return;
	}
	let post;
	const { data, error } = await supabase.from("blog_posts").select("*").eq("slug", slug).eq("status", "published").maybeSingle();
	if (!error) post = data;
	else if (/relation .*blog_posts.* does not exist|schema cache/i.test(error.message || "")) post = importedPosts.find((item) => item.slug === slug);
	else throw error;
	if (!post) {
		setStatus(status, "This article could not be found.", "error");
		return;
	}
	page.querySelector("[data-blog-post-title]").textContent = post.title;
	page.querySelector("[data-blog-post-meta]").textContent = `${post.author_display_name} · ${formatShortDate(post.published_at)}`;
	const cover = page.querySelector("[data-blog-post-cover]");
	const coverUrl = imageUrl(supabase, post.cover_image_source, post.cover_image_path);
	if (coverUrl) {
		cover.src = coverUrl;
		cover.alt = post.cover_image_alt || "";
		cover.hidden = false;
	}
	renderStructuredContent(page.querySelector("[data-blog-post-content]"), post.content, supabase);
	const allPosts = await fetchPublishedPosts(supabase);
	const recent = page.querySelector("[data-recent-posts]");
	allPosts.filter((item) => item.slug !== post.slug).slice(0, 3).forEach((item) => recent.appendChild(renderPostCard(item, supabase)));
	setStatus(status);
};

const createEditorBlock = (block = { type: "paragraph", text: "" }) => {
	const row = createElement("fieldset", "pca-editor-block");
	row.dataset.editorBlock = "true";
	const legend = createElement("legend", "", "Content Block");
	const fields = createElement("div", "fields");
	const typeField = createElement("div", "field one-third");
	const typeLabel = createElement("label", "", "Block Type");
	const type = createElement("select");
	type.name = "block_type";
	[["heading", "Heading"], ["paragraph", "Paragraph"], ["quote", "Quote"], ["image", "Image"]].forEach(([value, label]) => {
		const option = createElement("option", "", label);
		option.value = value;
		option.selected = block.type === value;
		type.appendChild(option);
	});
	typeField.append(typeLabel, type);
	const contentField = createElement("div", "field two-thirds");
	const contentLabel = createElement("label", "", "Text or Image Path");
	const content = createElement("textarea");
	content.name = "block_content";
	content.rows = 3;
	content.value = block.type === "image" ? (block.path || "") : (block.text || "");
	contentField.append(contentLabel, content);
	const altField = createElement("div", "field");
	const altLabel = createElement("label", "", "Image Alt Text");
	const alt = createElement("input");
	alt.name = "block_alt";
	alt.type = "text";
	alt.maxLength = 240;
	alt.value = block.alt || "";
	altField.append(altLabel, alt);
	const controls = createElement("div", "field pca-editor-block-actions");
	const remove = createElement("button", "button small", "Remove Block");
	remove.type = "button";
	remove.addEventListener("click", () => row.remove());
	controls.appendChild(remove);
	fields.append(typeField, contentField, altField, controls);
	row.append(legend, fields);
	const sync = () => {
		altField.hidden = type.value !== "image";
		contentLabel.textContent = type.value === "image" ? "Storage Image Path" : "Text";
	};
	type.addEventListener("change", sync);
	sync();
	return row;
};

const editorBlocksToJson = (container) => [...container.querySelectorAll("[data-editor-block]")].map((row) => {
	const type = row.querySelector('[name="block_type"]').value;
	const value = row.querySelector('[name="block_content"]').value.trim();
	if (type === "image") return { type, source: "storage", path: value, alt: row.querySelector('[name="block_alt"]').value.trim() };
	if (type === "heading") return { type, level: 2, text: value };
	return { type, text: value };
});

const initializeBlogEditor = async () => {
	const page = document.querySelector("[data-blog-editor]");
	if (!page) return;
	const session = await getSession();
	if (!session) {
		window.location.replace(`login.html?next=${encodeURIComponent("blog-editor.html")}`);
		return;
	}
	const context = await getAccountContext();
	const canEdit = Boolean(context.admin_level || context.teen_roles?.includes("editor"));
	if (!canEdit) {
		window.location.replace("blog.html");
		return;
	}
	const { supabase } = await platformReady();
	const form = page.querySelector("[data-blog-editor-form]");
	const status = page.querySelector("[data-blog-editor-status]");
	const blockList = page.querySelector("[data-editor-blocks]");
	const postId = new URLSearchParams(window.location.search).get("id");
	let existing = null;

	if (postId) {
		const { data, error } = await supabase.from("blog_posts").select("*").eq("id", postId).single();
		if (error) throw error;
		existing = data;
		form.elements.title.value = data.title;
		form.elements.slug.value = data.slug;
		form.elements.excerpt.value = data.excerpt;
		form.elements.author_display_name.value = data.author_display_name;
		form.elements.cover_image_path.value = data.cover_image_path || "";
		form.elements.cover_image_alt.value = data.cover_image_alt || "";
		form.elements.published.checked = data.status === "published";
		blockList.replaceChildren(...data.content.map(createEditorBlock));
	}
	if (!blockList.children.length) blockList.appendChild(createEditorBlock());
	if (!form.elements.author_display_name.value) form.elements.author_display_name.value = context.profile?.full_name || "PCA Youth Center";

	page.querySelector("[data-add-editor-block]").addEventListener("click", () => blockList.appendChild(createEditorBlock()));
	const upload = page.querySelector("[data-blog-media-upload]");
	upload.addEventListener("change", async () => {
		const file = upload.files?.[0];
		if (!file) return;
		if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) {
			setStatus(status, "Use a JPG, PNG, or WebP image no larger than 5 MB.", "error");
			return;
		}
		const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
		const path = `${session.user.id}/${crypto.randomUUID()}-${safeName}`;
		const { error } = await supabase.storage.from("blog-media").upload(path, file, { contentType: file.type, upsert: false });
		if (error) {
			setStatus(status, friendlyError(error, "The image could not be uploaded."), "error");
			return;
		}
		blockList.appendChild(createEditorBlock({ type: "image", source: "storage", path, alt: "" }));
		if (!form.elements.cover_image_path.value) form.elements.cover_image_path.value = path;
		setStatus(status, "Image uploaded and added as a content block. Add descriptive alt text before saving.", "success");
	});

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		const values = new FormData(form);
		const published = values.has("published");
		const coverPath = String(values.get("cover_image_path") || "").trim();
		const coverAlt = String(values.get("cover_image_alt") || "").trim();
		const payload = {
			slug: String(values.get("slug") || "").trim().toLowerCase(),
			title: String(values.get("title") || "").trim(),
			excerpt: String(values.get("excerpt") || "").trim(),
			content_version: 1,
			content: editorBlocksToJson(blockList),
			status: published ? "published" : "draft",
			published_at: published ? (existing?.published_at || new Date().toISOString()) : null,
			author_user_id: existing?.author_user_id || session.user.id,
			author_display_name: String(values.get("author_display_name") || "").trim(),
			cover_image_source: coverPath
				? (existing?.cover_image_path === coverPath ? existing.cover_image_source : "storage")
				: null,
			cover_image_path: coverPath || null,
			cover_image_alt: coverPath ? coverAlt : null,
		};
		setFormBusy(form, true, "Saving...");
		const result = existing
			? await supabase.from("blog_posts").update(payload).eq("id", existing.id).select("id").single()
			: await supabase.from("blog_posts").insert(payload).select("id").single();
		setFormBusy(form, false);
		if (result.error) {
			setStatus(status, friendlyError(result.error, "The post could not be saved."), "error");
			return;
		}
		setStatus(status, published ? "Post saved and published." : "Draft saved.", "success");
		if (!existing) window.history.replaceState(null, "", `blog-editor.html?id=${encodeURIComponent(result.data.id)}`);
	});

	const { data: posts, error: postsError } = await supabase.from("blog_posts").select("id,title,status,updated_at,author_user_id").order("updated_at", { ascending: false });
	if (!postsError) {
		const list = page.querySelector("[data-editor-post-list]");
		(posts || []).forEach((post) => {
			const item = createElement("li");
			const link = createElement("a", "", `${post.title} (${post.status})`);
			link.href = `blog-editor.html?id=${encodeURIComponent(post.id)}`;
			item.appendChild(link);
			list.appendChild(item);
		});
	}
};

export const initializeBlogPages = async () => {
	await Promise.all([initializeBlogFeed(), initializeBlogPost(), initializeBlogEditor()]);
};
