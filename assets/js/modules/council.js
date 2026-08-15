import {
	createElement,
	friendlyError,
	getAccountContext,
	getSession,
	platformReady,
	setFormBusy,
	setStatus,
} from "./core-auth.js?v=20260815-production-revamp-v4";

const bucketName = "council-headshots";

const initialsFor = (name = "") => name
	.trim()
	.split(/\s+/)
	.slice(0, 2)
	.map((part) => part[0]?.toUpperCase() || "")
	.join("") || "PCA";

const headshotUrl = (supabase, path) => path
	? supabase.storage.from(bucketName).getPublicUrl(path).data.publicUrl
	: "";

const renderPortrait = (container, member, supabase, { eager = false } = {}) => {
	container.replaceChildren();
	const url = headshotUrl(supabase, member.headshot_path);
	if (!url) {
		container.appendChild(createElement("span", "", initialsFor(member.full_name)));
		return;
	}
	const image = createElement("img");
	image.src = url;
	image.alt = `${member.full_name} headshot`;
	image.loading = eager ? "eager" : "lazy";
	image.decoding = "async";
	container.appendChild(image);
};

const createPersonCard = (member, supabase) => {
	const card = createElement("article", "pca-council-person");
	const body = createElement("div", "pca-council-person__body");
	body.append(
		createElement("h3", "", member.full_name),
		createElement("p", "pca-council-person__role", member.role_title)
	);
	if (member.bio) body.appendChild(createElement("p", "pca-council-person__bio", member.bio));
	if (member.headshot_path) {
		const portrait = createElement("div", "pca-council-person__portrait");
		renderPortrait(portrait, member, supabase);
		card.classList.add("has-portrait");
		card.append(portrait, body);
	} else {
		card.appendChild(body);
	}
	return card;
};

const createCouncilSection = (title, description, members, supabase, memberGrid = false) => {
	const section = createElement("section", "pca-council-section");
	const heading = createElement("div", "pca-council-section__heading");
	heading.append(createElement("h2", "", title), createElement("p", "", description));
	const grid = createElement("div", `pca-council-grid${memberGrid ? " is-members" : ""}`);
	members.forEach((member) => grid.appendChild(createPersonCard(member, supabase)));
	section.append(heading, grid);
	return section;
};

const initializePublicCouncil = async () => {
	const page = document.querySelector("[data-council-roster]");
	if (!page) return;
	const status = page.querySelector("[data-council-status]");
	const dynamic = page.querySelector("[data-council-dynamic]");
	const fallback = page.querySelector("[data-council-static]");
	const { supabase } = await platformReady();
	const { data: members, error } = await supabase
		.from("student_council_members")
		.select("id,full_name,role_title,member_group,bio,headshot_path,display_order")
		.eq("published", true)
		.order("display_order", { ascending: true })
		.order("full_name", { ascending: true });
	if (error) {
		if (/student_council_members|schema cache|relation/i.test(error.message || "")) {
			setStatus(status);
			return;
		}
		setStatus(status, friendlyError(error, "The current council roster could not be loaded."), "error");
		return;
	}

	const grouped = new Map([
		["advisor", []],
		["officer", []],
		["member", []],
	]);
	(members || []).forEach((member) => grouped.get(member.member_group)?.push(member));
	dynamic.replaceChildren();
	if (grouped.get("advisor").length) dynamic.appendChild(createCouncilSection(
		"Advisory Board",
		"Adult advisors support the council while keeping youth leadership at the center.",
		grouped.get("advisor"),
		supabase
	));
	if (grouped.get("officer").length) dynamic.appendChild(createCouncilSection(
		"Position Members",
		"Council officers coordinate programs, communications, and the teams behind each event.",
		grouped.get("officer"),
		supabase
	));
	if (grouped.get("member").length) dynamic.appendChild(createCouncilSection(
		"2025-2026 Council Members",
		"The student team that turns community ideas into welcoming PCA programs.",
		grouped.get("member"),
		supabase,
		true
	));
	dynamic.hidden = false;
	fallback.hidden = true;
	setStatus(status);
};

const createField = (labelText, name, control) => {
	const field = createElement("div", "field");
	const label = createElement("label", "", labelText);
	const id = `council-${name.replaceAll("_", "-")}`;
	label.htmlFor = id;
	control.id = id;
	control.name = name;
	field.append(label, control);
	return field;
};

const createInput = (type = "text") => {
	const input = createElement("input");
	input.type = type;
	return input;
};

export const prepareCouncilAdminShell = () => {
	const page = document.querySelector("[data-platform-admin]");
	if (!page || page.querySelector('[data-admin-tab="council"]')) return;
	const tabs = page.querySelector(".pca-admin-workspace-tabs");
	const publishingGroup = [...page.querySelectorAll(".pca-admin-tab-group")].find((group) => group.textContent.trim() === "Publishing");
	if (!tabs || !publishingGroup) return;

	const tab = createElement("button", "button small", "Student Council");
	tab.id = "admin-tab-council";
	tab.type = "button";
	tab.setAttribute("role", "tab");
	tab.setAttribute("aria-selected", "false");
	tab.setAttribute("aria-controls", "admin-panel-council");
	tab.tabIndex = -1;
	tab.dataset.adminTab = "council";
	tabs.insertBefore(tab, publishingGroup);

	const panel = createElement("section", "pca-admin-workspace-panel");
	panel.id = "admin-panel-council";
	panel.setAttribute("role", "tabpanel");
	panel.setAttribute("aria-labelledby", tab.id);
	panel.dataset.adminPanel = "council";
	panel.dataset.adminCouncil = "true";
	panel.hidden = true;
	panel.append(
		createElement("h2", "", "Student Council"),
		createElement("p", "", "Manage every council member, upload headshots, and edit the role and description shown beneath officers.")
	);
	const actions = createElement("ul", "actions");
	const actionItem = createElement("li");
	const add = createElement("button", "button primary", "Add Council Member");
	add.type = "button";
	add.dataset.councilAdd = "true";
	actionItem.appendChild(add);
	actions.appendChild(actionItem);
	const status = createElement("p", "pca-backend-status");
	status.dataset.councilAdminStatus = "true";
	status.setAttribute("aria-live", "polite");

	const layout = createElement("div", "pca-council-admin-layout");
	const list = createElement("div", "pca-council-admin-list");
	list.dataset.councilAdminList = "true";
	const editor = createElement("aside", "pca-paper-panel pca-council-editor");
	editor.dataset.councilEditor = "true";
	editor.hidden = true;
	const editorHeading = createElement("h3", "", "Edit roster entry");
	editorHeading.dataset.councilEditorTitle = "true";
	const form = createElement("form");
	form.dataset.councilForm = "true";
	const idInput = createInput("hidden");
	idInput.name = "id";
	const currentPath = createInput("hidden");
	currentPath.name = "current_headshot_path";
	const preview = createElement("div", "pca-council-editor__preview");
	preview.dataset.councilPreview = "true";
	const imageInput = createInput("file");
	imageInput.accept = "image/jpeg,image/png,image/webp";
	const imageField = createField("Headshot (JPG, PNG, or WebP up to 5 MB)", "headshot", imageInput);
	const imageActions = createElement("div", "pca-council-photo-actions");
	const cropImage = createElement("button", "button small", "Crop Selected Photo");
	cropImage.type = "button";
	cropImage.dataset.councilCrop = "true";
	cropImage.disabled = true;
	const deleteImage = createElement("button", "button small pca-button-danger", "Delete Photo");
	deleteImage.type = "button";
	deleteImage.dataset.councilPhotoDelete = "true";
	imageActions.append(cropImage, deleteImage);
	const removeWrap = createElement("div", "field");
	removeWrap.hidden = true;
	const removeImage = createInput("checkbox");
	removeImage.id = "council-remove-headshot";
	removeImage.name = "remove_headshot";
	const removeLabel = createElement("label", "", "Remove current headshot");
	removeLabel.htmlFor = removeImage.id;
	removeWrap.append(removeImage, removeLabel);

	const name = createInput();
	name.required = true;
	name.maxLength = 120;
	const role = createInput();
	role.required = true;
	role.maxLength = 120;
	const group = createElement("select");
	[["advisor", "Advisor"], ["officer", "Officer"], ["member", "Council Member"]].forEach(([value, label]) => {
		const option = createElement("option", "", label);
		option.value = value;
		group.appendChild(option);
	});
	const bio = createElement("textarea");
	bio.rows = 5;
	bio.maxLength = 1200;
	const order = createInput("number");
	order.min = "0";
	order.max = "10000";
	order.step = "1";
	order.required = true;
	const publishedWrap = createElement("div", "field");
	const published = createInput("checkbox");
	published.id = "council-published";
	published.name = "published";
	const publishedLabel = createElement("label", "", "Show on public Student Council page");
	publishedLabel.htmlFor = published.id;
	publishedWrap.append(published, publishedLabel);

	const help = createElement("p", "pca-form-help", "Officer descriptions appear directly beneath the officer role. Member descriptions are optional.");
	const formActions = createElement("div", "pca-registration-stage__actions");
	const cancel = createElement("button", "button", "Cancel");
	cancel.type = "button";
	cancel.dataset.councilCancel = "true";
	const save = createElement("button", "button primary", "Save Roster Entry");
	save.type = "submit";
	formActions.append(cancel, save);
	form.append(
		idInput,
		currentPath,
		preview,
		imageField,
		imageActions,
		removeWrap,
		createField("Full name", "full_name", name),
		createField("Role shown beneath name", "role_title", role),
		createField("Roster group", "member_group", group),
		createField("Description beneath officer or member", "bio", bio),
		createField("Display order", "display_order", order),
		publishedWrap,
		help,
		formActions
	);
	editor.append(editorHeading, form);
	layout.append(list, editor);
	panel.append(actions, status, layout);

	const content = page.querySelector(".pca-admin-workspace-content");
	const blogPanel = page.querySelector('[data-admin-panel="blog"]');
	content.insertBefore(panel, blogPanel);
};

const initializeAdminCouncil = async () => {
	const panel = document.querySelector("[data-admin-council]");
	if (!panel) return;
	const session = await getSession();
	if (!session) return;
	const context = await getAccountContext();
	if (!context.admin_level) return;
	const { supabase } = await platformReady();
	const list = panel.querySelector("[data-council-admin-list]");
	const editor = panel.querySelector("[data-council-editor]");
	const form = panel.querySelector("[data-council-form]");
	const status = panel.querySelector("[data-council-admin-status]");
	const preview = panel.querySelector("[data-council-preview]");
	const cropButton = panel.querySelector("[data-council-crop]");
	const photoDeleteButton = panel.querySelector("[data-council-photo-delete]");
	let members = [];
	let previewObjectUrl = "";
	let croppedHeadshot = null;
	let cropSourceUrl = "";

	const cropDialog = createElement("dialog", "pca-image-crop-dialog");
	const cropFrame = createElement("div", "pca-image-crop-dialog__frame");
	const cropHeading = createElement("h3", "", "Crop council photo");
	cropHeading.id = "pca-council-crop-title";
	const cropHelp = createElement("p", "", "Adjust the zoom and position. The saved headshot uses a consistent 4:5 portrait crop.");
	cropHelp.id = "pca-council-crop-help";
	cropDialog.setAttribute("aria-labelledby", cropHeading.id);
	cropDialog.setAttribute("aria-describedby", cropHelp.id);
	const cropCanvas = createElement("canvas");
	cropCanvas.width = 800;
	cropCanvas.height = 1000;
	cropCanvas.setAttribute("role", "img");
	cropCanvas.setAttribute("aria-label", "Cropped headshot preview");
	const cropControls = createElement("div", "pca-image-crop-controls");
	const makeRange = (labelText, min, max, value, step = "1") => {
		const label = createElement("label", "", labelText);
		const input = createElement("input");
		input.type = "range";
		input.min = String(min);
		input.max = String(max);
		input.value = String(value);
		input.step = step;
		label.appendChild(input);
		cropControls.appendChild(label);
		return input;
	};
	const cropZoom = makeRange("Zoom", 1, 3, 1, "0.01");
	const cropX = makeRange("Move left or right", -100, 100, 0);
	const cropY = makeRange("Move up or down", -100, 100, 0);
	const cropActions = createElement("div", "pca-registration-stage__actions");
	const cropCancel = createElement("button", "button", "Cancel");
	cropCancel.type = "button";
	const cropUse = createElement("button", "button primary", "Use Cropped Photo");
	cropUse.type = "button";
	cropActions.append(cropCancel, cropUse);
	cropFrame.append(cropHeading, cropHelp, cropCanvas, cropControls, cropActions);
	cropDialog.appendChild(cropFrame);
	document.body.appendChild(cropDialog);
	let cropImageElement = null;

	const clearCropSource = () => {
		if (cropSourceUrl) URL.revokeObjectURL(cropSourceUrl);
		cropSourceUrl = "";
		cropImageElement = null;
	};

	const drawCrop = () => {
		if (!cropImageElement) return;
		const context2d = cropCanvas.getContext("2d");
		const baseScale = Math.max(cropCanvas.width / cropImageElement.naturalWidth, cropCanvas.height / cropImageElement.naturalHeight);
		const scale = baseScale * Number(cropZoom.value);
		const width = cropImageElement.naturalWidth * scale;
		const height = cropImageElement.naturalHeight * scale;
		const maxX = Math.max(0, (width - cropCanvas.width) / 2);
		const maxY = Math.max(0, (height - cropCanvas.height) / 2);
		const x = (cropCanvas.width - width) / 2 + (Number(cropX.value) / 100) * maxX;
		const y = (cropCanvas.height - height) / 2 + (Number(cropY.value) / 100) * maxY;
		context2d.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
		context2d.drawImage(cropImageElement, x, y, width, height);
	};

	const openCropper = (file) => {
		clearCropSource();
		cropSourceUrl = URL.createObjectURL(file);
		cropImageElement = new Image();
		cropImageElement.onload = () => {
			cropZoom.value = "1";
			cropX.value = "0";
			cropY.value = "0";
			drawCrop();
			cropDialog.showModal();
		};
		cropImageElement.src = cropSourceUrl;
	};
	[cropZoom, cropX, cropY].forEach((control) => control.addEventListener("input", drawCrop));
	cropCancel.addEventListener("click", () => cropDialog.close());
	cropDialog.addEventListener("close", clearCropSource);
	cropUse.addEventListener("click", () => {
		cropCanvas.toBlob((blob) => {
			if (!blob) return;
			croppedHeadshot = blob;
			showPreview({ full_name: form.elements.full_name.value || "PCA" }, blob);
			cropDialog.close();
		}, "image/jpeg", 0.9);
	});

	const clearPreviewObjectUrl = () => {
		if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
		previewObjectUrl = "";
	};

	const showPreview = (member, file = null) => {
		clearPreviewObjectUrl();
		preview.replaceChildren();
		if (file) {
			previewObjectUrl = URL.createObjectURL(file);
			const image = createElement("img");
			image.src = previewObjectUrl;
			image.alt = "New headshot preview";
			preview.appendChild(image);
			return;
		}
		renderPortrait(preview, member, supabase, { eager: true });
	};

	const closeEditor = () => {
		clearPreviewObjectUrl();
		clearCropSource();
		croppedHeadshot = null;
		editor.hidden = true;
		form.reset();
	};

	const openEditor = (member = null) => {
		form.reset();
		const fallbackOrder = members.length ? Math.max(...members.map((item) => item.display_order || 0)) + 10 : 10;
		form.elements.id.value = member?.id || "";
		form.elements.current_headshot_path.value = member?.headshot_path || "";
		form.elements.full_name.value = member?.full_name || "";
		form.elements.role_title.value = member?.role_title || (!member || member.member_group === "member" ? "Council Member" : "");
		form.elements.member_group.value = member?.member_group || "member";
		form.elements.bio.value = member?.bio || "";
		form.elements.display_order.value = member?.display_order ?? fallbackOrder;
		form.elements.published.checked = member?.published ?? true;
		form.elements.remove_headshot.checked = false;
		croppedHeadshot = null;
		cropButton.disabled = true;
		photoDeleteButton.hidden = !member?.headshot_path;
		panel.querySelector("[data-council-editor-title]").textContent = member ? `Edit ${member.full_name}` : "Add council member";
		showPreview(member || { full_name: "PCA", headshot_path: null });
		editor.hidden = false;
		editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
	};

	const load = async () => {
		setStatus(status, "Loading council roster...", "info");
		const { data, error } = await supabase
			.from("student_council_members")
			.select("*")
			.order("display_order", { ascending: true })
			.order("full_name", { ascending: true });
		if (error) {
			setStatus(status, friendlyError(error, "The council roster could not be loaded."), "error");
			return;
		}
		members = data || [];
		list.replaceChildren();
		members.forEach((member) => {
			const row = createElement("article", "pca-council-admin-row");
			const image = createElement("div", "pca-council-admin-row__image");
			renderPortrait(image, member, supabase);
			const copy = createElement("div");
			copy.append(
				createElement("strong", "", member.full_name),
				createElement("p", "", `${member.role_title} · ${member.member_group} · order ${member.display_order}${member.published ? "" : " · hidden"}`)
			);
			const rowActions = createElement("div", "pca-council-admin-row__actions");
			const edit = createElement("button", "button small", "Edit");
			edit.type = "button";
			edit.addEventListener("click", () => openEditor(member));
			rowActions.appendChild(edit);
			if (member.headshot_path) {
				const removePhoto = createElement("button", "button small pca-button-danger", "Delete Photo");
				removePhoto.type = "button";
				removePhoto.addEventListener("click", async () => {
					if (!window.confirm(`Delete ${member.full_name}'s photo? The roster entry will be kept.`)) return;
					removePhoto.disabled = true;
					const { error: updateError } = await supabase.from("student_council_members").update({ headshot_path: null }).eq("id", member.id);
					if (updateError) {
						removePhoto.disabled = false;
						window.alert(friendlyError(updateError));
						return;
					}
					const { error: storageError } = await supabase.storage.from(bucketName).remove([member.headshot_path]);
					if (storageError) console.warn("The council photo file could not be deleted.", storageError);
					await load();
					setStatus(status, "Council photo deleted.", "success");
				});
				rowActions.appendChild(removePhoto);
			}
			row.append(image, copy, rowActions);
			list.appendChild(row);
		});
		if (!members.length) list.appendChild(createElement("p", "pca-empty-state", "No council members have been added yet."));
		setStatus(status, `${members.length} roster ${members.length === 1 ? "entry" : "entries"}.`, "info");
	};

	panel.querySelector("[data-council-add]").addEventListener("click", () => openEditor());
	panel.querySelector("[data-council-cancel]").addEventListener("click", closeEditor);
	form.elements.headshot.addEventListener("change", () => {
		const file = form.elements.headshot.files?.[0];
		croppedHeadshot = null;
		cropButton.disabled = !file;
		if (file) {
			form.elements.remove_headshot.checked = false;
			photoDeleteButton.hidden = false;
			showPreview({ full_name: form.elements.full_name.value || "PCA" }, file);
		}
	});
	cropButton.addEventListener("click", () => {
		const file = form.elements.headshot.files?.[0];
		if (file) openCropper(file);
	});
	photoDeleteButton.addEventListener("click", () => {
		form.elements.headshot.value = "";
		form.elements.remove_headshot.checked = true;
		croppedHeadshot = null;
		cropButton.disabled = true;
		photoDeleteButton.hidden = true;
		showPreview({ full_name: form.elements.full_name.value || "PCA", headshot_path: null });
	});
	form.elements.full_name.addEventListener("input", () => {
		if (!form.elements.headshot.files?.length && !form.elements.current_headshot_path.value) {
			showPreview({ full_name: form.elements.full_name.value || "PCA", headshot_path: null });
		}
	});
	form.elements.member_group.addEventListener("change", () => {
		if (form.elements.member_group.value === "member" && !form.elements.role_title.value.trim()) {
			form.elements.role_title.value = "Council Member";
		}
	});

	form.addEventListener("submit", async (event) => {
		event.preventDefault();
		setStatus(status);
		const values = new FormData(form);
		const originalFile = form.elements.headshot.files?.[0];
		const file = croppedHeadshot || originalFile;
		if (file && (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024)) {
			setStatus(status, "Use a JPG, PNG, or WebP headshot no larger than 5 MB.", "error");
			return;
		}
		const id = String(values.get("id") || crypto.randomUUID());
		const oldPath = String(values.get("current_headshot_path") || "");
		let uploadedPath = "";
		let nextPath = values.has("remove_headshot") ? null : (oldPath || null);
		setFormBusy(form, true, "Saving...");
		if (file) {
			const safeName = (croppedHeadshot ? "cropped-headshot.jpg" : (originalFile?.name || "headshot"))
				.toLowerCase()
				.replace(/[^a-z0-9._-]+/g, "-");
			uploadedPath = `${id}/${crypto.randomUUID()}-${safeName}`;
			const { error: uploadError } = await supabase.storage.from(bucketName).upload(uploadedPath, file, {
				contentType: file.type,
				upsert: false,
			});
			if (uploadError) {
				setFormBusy(form, false);
				setStatus(status, friendlyError(uploadError, "The headshot could not be uploaded."), "error");
				return;
			}
			nextPath = uploadedPath;
		}
		const payload = {
			id,
			full_name: String(values.get("full_name") || "").trim(),
			role_title: String(values.get("role_title") || "").trim(),
			member_group: String(values.get("member_group") || "member"),
			bio: String(values.get("bio") || "").trim(),
			headshot_path: nextPath,
			display_order: Number(values.get("display_order")),
			published: values.has("published"),
		};
		const result = values.get("id")
			? await supabase.from("student_council_members").update(payload).eq("id", id)
			: await supabase.from("student_council_members").insert(payload);
		setFormBusy(form, false);
		if (result.error) {
			if (uploadedPath) await supabase.storage.from(bucketName).remove([uploadedPath]);
			setStatus(status, friendlyError(result.error, "The roster entry could not be saved."), "error");
			return;
		}
		if (oldPath && oldPath !== nextPath) {
			const { error: cleanupError } = await supabase.storage.from(bucketName).remove([oldPath]);
			if (cleanupError) console.warn("The prior council headshot could not be removed.", cleanupError);
		}
		closeEditor();
		await load();
		setStatus(status, "Council roster entry saved.", "success");
	});

	await load();
};

export const initializeCouncilPages = async () => {
	await Promise.all([
		initializePublicCouncil(),
		initializeAdminCouncil(),
	]);
};
