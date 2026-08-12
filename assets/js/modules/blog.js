import {
	createElement,
	formatShortDate,
	friendlyError,
	getAccountContext,
	getSession,
	platformReady,
	setFormBusy,
	setStatus,
} from "./core-auth.js?v=20260812-production-revamp-v2";
let importedPostsPromise;

const loadImportedPosts = async () => {
	importedPostsPromise ||= import("./blog-seed.js?v=20260812-production-revamp-v2").then(({ importedPosts }) => importedPosts);
	return importedPostsPromise;
};

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
	if (/relation .*blog_posts.* does not exist|schema cache/i.test(error.message || "")) return loadImportedPosts();
	throw error;
};

const renderPostCard = (post, supabase) => {
	const card = createElement("article", "pca-card pca-blog-card");
	const coverUrl = imageUrl(supabase, post.cover_image_source, post.cover_image_path);
	if (coverUrl) {
		card.classList.add("has-cover");
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
	const title = createElement("h3");
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
	const search = page.querySelector("[data-blog-search]");
	const count = page.querySelector("[data-blog-count]");
	const empty = page.querySelector("[data-blog-empty]");
	const more = page.querySelector("[data-blog-more]");
	try {
		const posts = await fetchPublishedPosts(supabase);
		let visibleCount = 9;
		const render = () => {
			const query = search?.value.trim().toLocaleLowerCase() || "";
			const matches = query
				? posts.filter((post) => [post.title, post.excerpt, post.author_display_name].some((value) => String(value || "").toLocaleLowerCase().includes(query)))
				: posts;
			list.replaceChildren();
			matches.slice(0, visibleCount).forEach((post) => list.appendChild(renderPostCard(post, supabase)));
			const shown = Math.min(matches.length, visibleCount);
			if (count) count.textContent = matches.length > shown
				? `${matches.length} stories · showing ${shown}`
				: `${matches.length} ${matches.length === 1 ? "story" : "stories"}`;
			if (empty) empty.hidden = matches.length > 0;
			if (more) more.hidden = matches.length <= visibleCount;
		};
		search?.addEventListener("input", () => {
			visibleCount = 9;
			render();
		});
		more?.addEventListener("click", () => {
			visibleCount += 8;
			render();
			list.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
		});
		render();
		setStatus(status);
	} catch (error) {
		setStatus(status, friendlyError(error, "Blog posts could not be loaded."), "error");
	}
};

const initializeBlogPost = async () => {
	const page = document.querySelector("[data-blog-post]");
	if (!page) return;
	const { supabase } = await platformReady();
	const params = new URLSearchParams(window.location.search);
	const slug = params.get("slug");
	const previewId = params.get("preview");
	const status = page.querySelector("[data-blog-post-status]");
	const recovery = page.querySelector("[data-blog-post-recovery]");
	const showRecovery = (message) => {
		page.querySelector("[data-blog-post-title]").textContent = "Article Unavailable";
		page.querySelector("[data-blog-post-meta]").textContent = "PCA Stories";
		page.querySelector("[data-blog-post-content]").replaceChildren();
		page.querySelector("[data-blog-post-cover]").hidden = true;
		const recentSection = page.querySelector("[data-recent-posts]")?.closest("section");
		if (recentSection) recentSection.hidden = true;
		document.title = "Article Unavailable | PCA Youth Center";
		setStatus(status, message, "error");
		if (recovery) recovery.hidden = false;
	};
	if (!slug && !previewId) {
		showRecovery("Choose an article from the blog.");
		return;
	}
	let post;
	if (previewId) {
		const session = await getSession();
		if (!session) {
			window.location.replace(`login.html?next=${encodeURIComponent(`post.html?preview=${previewId}`)}`);
			return;
		}
		const context = await getAccountContext();
		if (!context.admin_level && !context.teen_roles?.includes("editor")) {
			showRecovery("You do not have permission to preview this post.");
			return;
		}
		const { data, error } = await supabase.from("blog_posts").select("*").eq("id", previewId).maybeSingle();
		if (error) throw error;
		post = data;
	} else {
		const { data, error } = await supabase.from("blog_posts").select("*").eq("slug", slug).eq("status", "published").maybeSingle();
		if (!error) post = data;
		else if (/relation .*blog_posts.* does not exist|schema cache/i.test(error.message || "")) {
			post = (await loadImportedPosts()).find((item) => item.slug === slug);
		}
		else throw error;
	}
	if (!post) {
		showRecovery("This article could not be found.");
		return;
	}
	page.querySelector("[data-blog-post-title]").textContent = post.title;
	const postDate = post.published_at || post.updated_at || post.created_at;
	page.querySelector("[data-blog-post-meta]").textContent = previewId
		? `Private ${post.status === "published" ? "published-post" : "draft"} preview · ${post.author_display_name} · Updated ${formatShortDate(postDate)}`
		: `${post.author_display_name} · ${formatShortDate(postDate)}`;
	document.title = `${post.title} | PCA Youth Center`;
	const description = document.querySelector('meta[name="description"]');
	if (description) description.content = post.excerpt || "Read the latest story from PCA Youth Center.";
	let canonical = document.querySelector('link[rel="canonical"]');
	if (!previewId) {
		if (!canonical) {
			canonical = document.createElement("link");
			canonical.rel = "canonical";
			document.head.appendChild(canonical);
		}
		canonical.href = new URL(`post.html?slug=${encodeURIComponent(post.slug)}`, window.location.href).href;
	}
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
	recent.replaceChildren();
	allPosts.filter((item) => item.slug !== post.slug).slice(0, 3).forEach((item) => recent.appendChild(renderPostCard(item, supabase)));
	setStatus(status, previewId ? "This preview is private. Return to the editor to make changes or publish." : "", previewId ? "info" : "");
};

let editorBlockSequence = 0;

const slugify = (value) => String(value || "")
	.normalize("NFKD")
	.replace(/[\u0300-\u036f]/g, "")
	.toLowerCase()
	.replace(/[^a-z0-9]+/g, "-")
	.replace(/^-+|-+$/g, "")
	.slice(0, 120)
	.replace(/-+$/g, "");

const renumberEditorBlocks = (container) => {
	[...container.querySelectorAll("[data-editor-block]")].forEach((row, index) => {
		const legend = row.querySelector("legend");
		if (legend) legend.textContent = `Article section ${index + 1}`;
	});
};

const createEditorBlock = (block = { type: "paragraph", text: "" }, supabase) => {
	editorBlockSequence += 1;
	const idBase = `blog-block-${editorBlockSequence}`;
	const isImage = block.type === "image";
	const row = createElement("fieldset", "pca-editor-block");
	row.dataset.editorBlock = "true";
	row.dataset.imageSource = block.source || "storage";
	row.dataset.headingLevel = String(block.level === 3 ? 3 : 2);
	const legend = createElement("legend", "", "Article section");
	const fields = createElement("div", "fields");
	const typeField = createElement("div", "field one-third");
	const typeLabel = createElement("label", "", "Section format");
	const type = createElement("select");
	type.id = `${idBase}-type`;
	typeLabel.htmlFor = type.id;
	type.name = "block_type";
	const typeOptions = isImage
		? [["image", "Image"]]
		: [["heading", "Section heading"], ["paragraph", "Paragraph"], ["quote", "Highlighted quote"]];
	typeOptions.forEach(([value, label]) => {
		const option = createElement("option", "", label);
		option.value = value;
		option.selected = block.type === value;
		type.appendChild(option);
	});
	type.disabled = isImage;
	typeField.append(typeLabel, type);
	const contentField = createElement("div", "field two-thirds");
	const contentLabel = createElement("label", "", isImage ? "Image file" : "Section text");
	const content = createElement(isImage ? "input" : "textarea");
	content.id = `${idBase}-content`;
	contentLabel.htmlFor = content.id;
	content.name = "block_content";
	if (isImage) {
		content.type = "hidden";
	} else {
		content.rows = 4;
		content.maxLength = type.value === "heading" ? 180 : 5000;
	}
	content.value = block.type === "image" ? (block.path || "") : (block.text || "");
	if (isImage) {
		const preview = createElement("img", "pca-blog-inline-image");
		preview.src = imageUrl(supabase, row.dataset.imageSource, block.path || "");
		preview.alt = block.alt || "Uploaded article image preview";
		preview.loading = "lazy";
		contentField.append(content, preview, createElement("p", "pca-form-help", "This image is managed by the uploader. Add a useful description below."));
	} else {
		contentField.append(contentLabel, content);
	}
	const altField = createElement("div", "field");
	const altLabel = createElement("label", "", "Image description");
	const alt = createElement("input");
	alt.id = `${idBase}-alt`;
	altLabel.htmlFor = alt.id;
	alt.name = "block_alt";
	alt.type = "text";
	alt.maxLength = 240;
	alt.value = block.alt || "";
	altField.append(altLabel, alt, createElement("p", "pca-form-help", "Describe the important visual information for visitors who cannot see the image."));
	const controls = createElement("div", "field pca-editor-block-actions");
	const moveUp = createElement("button", "button small", "Move up");
	moveUp.type = "button";
	moveUp.setAttribute("aria-label", "Move this article section up");
	moveUp.addEventListener("click", () => {
		const previous = row.previousElementSibling;
		if (previous) row.parentElement.insertBefore(row, previous);
		renumberEditorBlocks(row.parentElement);
	});
	const moveDown = createElement("button", "button small", "Move down");
	moveDown.type = "button";
	moveDown.setAttribute("aria-label", "Move this article section down");
	moveDown.addEventListener("click", () => {
		const next = row.nextElementSibling;
		if (next) row.parentElement.insertBefore(next, row);
		renumberEditorBlocks(row.parentElement);
	});
	const remove = createElement("button", "button small", "Remove section");
	remove.type = "button";
	remove.addEventListener("click", () => {
		const hasContent = content.value.trim() || alt.value.trim();
		if (hasContent && !window.confirm("Remove this section? Its unsaved text or image will be removed from the article.")) return;
		const container = row.parentElement;
		row.remove();
		renumberEditorBlocks(container);
	});
	controls.append(moveUp, moveDown, remove);
	fields.append(typeField, contentField, altField, controls);
	row.append(legend, fields);
	const sync = () => {
		altField.hidden = type.value !== "image";
		contentLabel.textContent = type.value === "heading" ? "Heading text" : type.value === "quote" ? "Quote text" : "Paragraph text";
		if (!isImage) content.maxLength = type.value === "heading" ? 180 : 5000;
	};
	type.addEventListener("change", sync);
	sync();
	return row;
};

const editorBlocksToJson = (container) => [...container.querySelectorAll("[data-editor-block]")].map((row) => {
	const type = row.querySelector('[name="block_type"]').value;
	const value = row.querySelector('[name="block_content"]').value.trim();
	if (type === "image") return { type, source: row.dataset.imageSource || "storage", path: value, alt: row.querySelector('[name="block_alt"]').value.trim() };
	if (type === "heading") return { type, level: Number(row.dataset.headingLevel) === 3 ? 3 : 2, text: value };
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
	const titleInput = form.elements.title;
	const slugInput = form.elements.slug;
	const excerptInput = form.elements.excerpt;
	const coverPathInput = form.elements.cover_image_path;
	const coverSourceInput = form.elements.cover_image_source;
	const coverAltInput = form.elements.cover_image_alt;
	const linkPreview = page.querySelector("[data-blog-link-preview]");
	const previewLink = page.querySelector("[data-blog-preview]");
	const coverPreview = page.querySelector("[data-blog-cover-preview]");
	const clearCover = page.querySelector("[data-clear-blog-cover]");
	const excerptCount = page.querySelector("[data-blog-excerpt-count]");
	const saveState = page.querySelector("[data-blog-save-state]");
	const postList = page.querySelector("[data-editor-post-list]");
	let existing = null;
	let dirty = false;
	let slugManuallyEdited = false;
	const previewWindow = () => {
		if (!existing?.id) return;
		window.open(`post.html?preview=${encodeURIComponent(existing.id)}`, "_blank", "noopener");
	};

	const setSaveState = (message, kind = "") => {
		if (!saveState) return;
		setStatus(saveState, message, kind);
	};

	const markDirty = () => {
		dirty = true;
		setSaveState("Unsaved changes", "info");
	};

	const updateExcerptCount = () => {
		if (excerptCount) excerptCount.textContent = `${excerptInput.value.length} of 600 characters`;
	};

	const updateLinkPreview = () => {
		const normalizedSlug = slugify(slugInput.value);
		const relativeUrl = normalizedSlug ? `post.html?slug=${encodeURIComponent(normalizedSlug)}` : "post.html?slug=your-post-title";
		if (linkPreview) linkPreview.textContent = relativeUrl;
		if (previewLink) {
			previewLink.hidden = !existing?.id;
			if (existing?.id) previewLink.href = `post.html?preview=${encodeURIComponent(existing.id)}`;
		}
	};

	const updateCoverPreview = () => {
		const coverPath = coverPathInput.value.trim();
		const coverSource = coverSourceInput.value || "storage";
		if (coverPreview) {
			coverPreview.hidden = !coverPath;
			if (coverPath) {
				coverPreview.src = imageUrl(supabase, coverSource, coverPath);
				coverPreview.alt = coverAltInput.value.trim() || "Cover image preview";
			}
		}
		if (clearCover) clearCover.hidden = !coverPath;
		coverAltInput.required = Boolean(coverPath);
	};

	const addBlock = (type = "paragraph") => {
		const block = type === "heading" ? { type, level: 2, text: "" } : { type, text: "" };
		const row = createEditorBlock(block, supabase);
		blockList.appendChild(row);
		renumberEditorBlocks(blockList);
		row.querySelector('[name="block_content"]')?.focus();
		markDirty();
	};

	const loadPostList = async () => {
		postList.replaceChildren();
		let query = supabase.from("blog_posts").select("id,title,status,updated_at,author_user_id").order("updated_at", { ascending: false });
		if (!context.admin_level) query = query.eq("author_user_id", session.user.id);
		const { data: posts, error } = await query;
		if (error) {
			const item = createElement("li", "", "Posts could not be loaded. Refresh to try again.");
			postList.appendChild(item);
			return;
		}
		if (!posts?.length) {
			postList.appendChild(createElement("li", "", "No drafts or published posts yet."));
			return;
		}
		posts.forEach((post) => {
			const item = createElement("li");
			const link = createElement("a", "", `${post.title} — ${post.status === "published" ? "Published" : "Draft"}, updated ${formatShortDate(post.updated_at)}`);
			link.href = `blog-editor.html?id=${encodeURIComponent(post.id)}`;
			if (existing?.id === post.id) link.setAttribute("aria-current", "page");
			item.appendChild(link);
			postList.appendChild(item);
		});
	};

	if (postId) {
		const { data, error } = await supabase.from("blog_posts").select("*").eq("id", postId).maybeSingle();
		if (error) throw error;
		if (!data || (!context.admin_level && data.author_user_id !== session.user.id)) {
			form.hidden = true;
			setStatus(status, "This post is not available to edit. Choose one of your posts or start a new post.", "error");
			await loadPostList();
			return;
		}
		existing = data;
		titleInput.value = data.title;
		slugInput.value = data.slug;
		excerptInput.value = data.excerpt;
		form.elements.author_display_name.value = data.author_display_name;
		coverPathInput.value = data.cover_image_path || "";
		coverSourceInput.value = data.cover_image_source || "";
		coverAltInput.value = data.cover_image_alt || "";
		form.elements.published.checked = data.status === "published";
		blockList.replaceChildren(...data.content.map((block) => createEditorBlock(block, supabase)));
		slugManuallyEdited = true;
	}
	if (!blockList.children.length) blockList.appendChild(createEditorBlock({ type: "paragraph", text: "" }, supabase));
	renumberEditorBlocks(blockList);
	if (!form.elements.author_display_name.value) form.elements.author_display_name.value = context.profile?.full_name || "PCA Youth Center";
	updateExcerptCount();
	updateLinkPreview();
	updateCoverPreview();
	setSaveState(existing ? `Loaded ${existing.status === "published" ? "published post" : "draft"}.` : "New unsaved draft.", "info");

	page.querySelectorAll("[data-add-editor-block]").forEach((button) => {
		button.addEventListener("click", () => addBlock(button.dataset.addEditorBlock || "paragraph"));
	});
	previewLink?.addEventListener("click", (event) => {
		event.preventDefault();
		previewWindow();
	});
	page.querySelector("[data-regenerate-blog-link]")?.addEventListener("click", () => {
		slugManuallyEdited = false;
		slugInput.value = slugify(titleInput.value);
		updateLinkPreview();
		markDirty();
		slugInput.focus();
	});
	titleInput.addEventListener("input", () => {
		if (!slugManuallyEdited) slugInput.value = slugify(titleInput.value);
		updateLinkPreview();
	});
	slugInput.addEventListener("input", () => {
		slugManuallyEdited = true;
		const normalized = slugify(slugInput.value);
		if (slugInput.value !== normalized) slugInput.value = normalized;
		updateLinkPreview();
	});
	excerptInput.addEventListener("input", updateExcerptCount);
	coverAltInput.addEventListener("input", updateCoverPreview);
	clearCover?.addEventListener("click", () => {
		if (!window.confirm("Remove the cover image from this post? The same image will stay in the article unless you remove its image section separately.")) return;
		coverPathInput.value = "";
		coverSourceInput.value = "";
		coverAltInput.value = "";
		updateCoverPreview();
		markDirty();
	});
	blockList.addEventListener("click", (event) => {
		if (event.target.closest(".pca-editor-block-actions button")) markDirty();
	});
	form.addEventListener("input", markDirty);
	form.addEventListener("change", markDirty);
	window.addEventListener("beforeunload", (event) => {
		if (!dirty) return;
		event.preventDefault();
		event.returnValue = "";
	});

	const upload = page.querySelector("[data-blog-media-upload]");
	upload.addEventListener("change", async () => {
		const file = upload.files?.[0];
		if (!file) return;
		if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) {
			setStatus(status, "Use a JPG, PNG, or WebP image no larger than 5 MB.", "error");
			upload.value = "";
			return;
		}
		upload.disabled = true;
		setStatus(status, "Uploading image...", "info");
		try {
			const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
			const path = `${session.user.id}/${crypto.randomUUID()}-${safeName}`;
			const { error } = await supabase.storage.from("blog-media").upload(path, file, { contentType: file.type, upsert: false });
			if (error) throw error;
			blockList.appendChild(createEditorBlock({ type: "image", source: "storage", path, alt: "" }, supabase));
			renumberEditorBlocks(blockList);
			if (!coverPathInput.value) {
				coverPathInput.value = path;
				coverSourceInput.value = "storage";
				updateCoverPreview();
			}
			markDirty();
			setStatus(status, "Image uploaded. Add an image description before saving.", "success");
			blockList.lastElementChild?.querySelector('[name="block_alt"]')?.focus();
		} catch (error) {
			setStatus(status, friendlyError(error, "The image could not be uploaded."), "error");
		} finally {
			upload.disabled = false;
			upload.value = "";
		}
	});

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		setStatus(status);
		slugInput.value = slugify(slugInput.value);
		if (slugInput.value.length < 3) {
			setStatus(status, "The Blog Link needs at least three letters or numbers. Use the suggested link or enter a longer one.", "error");
			slugInput.focus();
			return;
		}
		if (!form.reportValidity()) return;
		const values = new FormData(form);
		const published = values.has("published");
		const coverPath = String(values.get("cover_image_path") || "").trim();
		const coverAlt = String(values.get("cover_image_alt") || "").trim();
		const content = editorBlocksToJson(blockList);
		if (!content.length) {
			setStatus(status, "Add at least one article section before saving.", "error");
			return;
		}
		for (let index = 0; index < content.length; index += 1) {
			const block = content[index];
			const row = blockList.querySelectorAll("[data-editor-block]")[index];
			if (block.type === "image" && (!block.path || !block.alt)) {
				setStatus(status, `Article section ${index + 1} needs an image description before saving.`, "error");
				row.querySelector('[name="block_alt"]')?.focus();
				return;
			}
			if (block.type !== "image" && !block.text) {
				setStatus(status, `Article section ${index + 1} is empty. Add text or remove the section.`, "error");
				row.querySelector('[name="block_content"]')?.focus();
				return;
			}
		}
		if (coverPath && !coverAlt) {
			setStatus(status, "Add a description for the cover image before saving.", "error");
			coverAltInput.focus();
			return;
		}
		const payload = {
			slug: slugInput.value,
			title: String(values.get("title") || "").trim(),
			excerpt: String(values.get("excerpt") || "").trim(),
			content_version: 1,
			content,
			status: published ? "published" : "draft",
			published_at: published ? (existing?.published_at || new Date().toISOString()) : null,
			author_user_id: existing?.author_user_id || session.user.id,
			author_display_name: String(values.get("author_display_name") || "").trim(),
			cover_image_source: coverPath ? (String(values.get("cover_image_source") || "") || "storage") : null,
			cover_image_path: coverPath || null,
			cover_image_alt: coverPath ? coverAlt : null,
		};
		setFormBusy(form, true, "Saving...");
		let result;
		try {
			result = existing
				? await supabase.from("blog_posts").update(payload).eq("id", existing.id).select("*").single()
				: await supabase.from("blog_posts").insert(payload).select("*").single();
		} catch (error) {
			setStatus(status, friendlyError(error, "The post could not be saved."), "error");
			setFormBusy(form, false);
			return;
		}
		setFormBusy(form, false);
		if (result.error) {
			setStatus(status, friendlyError(result.error, "The post could not be saved."), "error");
			return;
		}
		existing = result.data;
		dirty = false;
		setStatus(status, published ? "Post saved and published." : "Draft saved.", "success");
		setSaveState(`Saved just now as ${published ? "Published" : "Draft"}.`, "success");
		window.history.replaceState(null, "", `blog-editor.html?id=${encodeURIComponent(existing.id)}`);
		updateLinkPreview();
		await loadPostList();
	});

	await loadPostList();
};

export const initializeBlogPages = async () => {
	await Promise.all([initializeBlogFeed(), initializeBlogPost(), initializeBlogEditor()]);
};
